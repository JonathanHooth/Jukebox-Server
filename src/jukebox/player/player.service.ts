import { CACHE_MANAGER } from '@nestjs/cache-manager'
import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Cache } from 'cache-manager'
import { UserDto } from 'src/shared'
import { SpotifyService } from 'src/spotify/spotify.service'
import { TrackDto } from 'src/track/dto/track.dto'
import { Repository } from 'typeorm'
import { AccountLinkService } from '../account-link/account-link.service'
import { QueuedTrackDto } from '../queue/dto'
import { QueueService } from '../queue/queue.service'
import { ActionType, PlayerActionDto, PlayerStateDto, SetPlayerDeviceDto } from './dto'
import { InteractionType, PlayerInteraction } from './entity/player-interaction.entity'

const TRIGGER_THRESHOLD_MS = 1500

@Injectable()
export class PlayerService {
  private readonly logger = new Logger(PlayerService.name)

  /**
   * Guards against triggering next-track twice when progress ticks
   * straddle the threshold. Keyed by jukeboxId.
   */
  private readonly transitioning = new Set<number>()

  constructor(
    @InjectRepository(PlayerInteraction) private repo: Repository<PlayerInteraction>,
    @Inject(CACHE_MANAGER) private cache: Cache,
    private spotifyService: SpotifyService,
    private accountLinkService: AccountLinkService,
    private queueService: QueueService,
  ) {}

  private async setPlayerState(jukeboxId: number, payload: PlayerStateDto) {
    await this.cache.set(`jukebox-${jukeboxId}`, payload)
  }

  private async updatePlayerState(
    jukeboxId: number,
    payload: Partial<PlayerStateDto> | ((state: PlayerStateDto) => PlayerStateDto),
  ) {
    const currentState = await this.getPlayerState(jukeboxId)
    let updatedState: PlayerStateDto

    if (typeof payload === 'function') {
      updatedState = payload(currentState)
    } else {
      updatedState = { ...currentState, ...payload }
    }

    await this.setPlayerState(jukeboxId, updatedState)
    return updatedState
  }

  /**
   * Get or Create the player state for a jukebox.
   */
  async getPlayerState(jukeboxId: number): Promise<PlayerStateDto> {
    let cachedState = await this.cache.get<PlayerStateDto>(`jukebox-${jukeboxId}`)
    if (!cachedState) {
      const accountLink = await this.accountLinkService.getActiveAccount(jukeboxId)
      const spotify_track = await this.spotifyService.getCurrentTrack(accountLink.spotify_account)

      cachedState = {
        jukebox_id: jukeboxId,
        is_playing: false,
        last_progress_update: new Date(),
        progress: 0,
        spotify_track: spotify_track,
      }
      await this.setPlayerState(jukeboxId, cachedState)
    }

    return cachedState
  }

  /**
   * Transfer playback to the device with id in spotify.
   * Save this id as the current device id in the player state.
   */
  async setPlayerDeviceId(jukeboxId: number, payload: SetPlayerDeviceDto): Promise<PlayerStateDto> {
    const { device_id } = payload
    const activeAccount = await this.accountLinkService.getActiveAccount(jukeboxId)
    await this.spotifyService.setPlayerDevice(activeAccount.spotify_account, device_id)
    return await this.updatePlayerState(jukeboxId, { current_device_id: device_id })
  }

  /**
   * Called on every progress tick from the client. Updates cached progress
   * and — if a juke session is active and the track is nearly over —
   * pops the top-voted next track and plays it immediately via Spotify.
   *
   * The decision is made here at the last viable moment (~1.5s before end),
   * so votes are valid right up until that point.
   */
  async setCurrentProgress(
    jukeboxId: number,
    progress: number,
    duration_ms?: number,
    jukeSessionId?: number,
    timestamp?: Date,
  ): Promise<PlayerStateDto> {
    const cachedState = await this.getPlayerState(jukeboxId)
    cachedState.progress = progress
    cachedState.last_progress_update = timestamp || new Date()
    await this.setPlayerState(jukeboxId, cachedState)

    // Trigger next track if we're within threshold, have a session, and aren't already transitioning
    if (
      duration_ms != null &&
      jukeSessionId != null &&
      !this.transitioning.has(jukeboxId) &&
      duration_ms - progress <= TRIGGER_THRESHOLD_MS
    ) {
      // Set flag synchronously before any awaits to prevent re-entry
      console.log('NEXT TRACK')
      this.transitioning.add(jukeboxId)
      this.triggerNextTrack(jukeboxId, jukeSessionId).catch((err) => {
        this.logger.error(`Failed to trigger next track for jukebox ${jukeboxId}: ${err.message}`)
        // Clear on failure so the next tick can retry
        this.transitioning.delete(jukeboxId)
      })
    }

    return cachedState
  }

  /**
   * Pops the top-voted track from the queue and tells Spotify to play it.
   * Called internally when a track is nearly over.
   */
  private async triggerNextTrack(jukeboxId: number, jukeSessionId: number): Promise<void> {
    try {
      const { current_device_id } = await this.getPlayerState(jukeboxId)
      if (!current_device_id) {
        this.logger.warn(`Jukebox ${jukeboxId} has no active device, cannot play next track`)
        return
      }

      const accountLink = await this.accountLinkService.getActiveAccount(jukeboxId)

      let nextTrack: QueuedTrackDto
      try {
        // popNextTrack resolves winner by likes DESC, insertion order as tiebreak.
        // This runs at the last viable moment so votes count for as long as possible.
        nextTrack = await this.queueService.popNextTrack(jukeSessionId)
      } catch (err) {
        if (err instanceof NotFoundException) {
          this.logger.log(`Queue empty for session ${jukeSessionId}, letting Spotify continue`)
          return
        }
        throw err
      }

      await this.spotifyService.playTrack(
        accountLink.spotify_account,
        current_device_id,
        nextTrack.track.spotify_uri,
      )

      await this.setCurrentQueuedTrack(jukeboxId, nextTrack)
      this.logger.log(`Jukebox ${jukeboxId} → now playing "${nextTrack.track.name}"`)
    } finally {
      // Hold the flag for 3s so the next few progress ticks (which still reflect the
      // old track before Spotify switches) don't re-trigger
      setTimeout(() => this.transitioning.delete(jukeboxId), 3000)
    }
  }

  /**
   * A user either like/disliked the currently playing track.
   */
  async addInteraction(
    jukeboxId: number,
    user: UserDto,
    interaction_type: InteractionType,
  ): Promise<PlayerStateDto> {
    const { queued_track } = await this.getPlayerState(jukeboxId)

    if (!queued_track)
      throw new BadRequestException(
        'Cannot interact with the player if a queued track is not playing.',
      )

    const interaction = this.repo.create({
      queued_track: { id: queued_track.id },
      user_id: user.id,
      interaction_type,
    })
    await this.repo.save(interaction)

    return await this.updatePlayerState(jukeboxId, (state) => {
      if (interaction_type === InteractionType.LIKE) {
        return {
          ...state,
          queued_track: { ...state.queued_track!, likes: state.queued_track!.likes + 1 },
        }
      } else {
        return {
          ...state,
          queued_track: { ...state.queued_track!, dislikes: state.queued_track!.dislikes + 1 },
        }
      }
    })
  }

  /**
   * Set whether the current track is playing.
   */
  async setIsPlaying(jukeboxId: number, isPlaying: boolean): Promise<PlayerStateDto> {
    return await this.updatePlayerState(jukeboxId, { is_playing: isPlaying })
  }

  /**
   * Sets a track that wasn't in the queue as currently playing.
   */
  async setCurrentSpotifyTrack(jukeboxId: number, track: TrackDto | null): Promise<PlayerStateDto> {
    return await this.updatePlayerState(jukeboxId, {
      spotify_track: track ?? undefined,
      queued_track: undefined,
    })
  }

  /**
   * Sets a queued track as currently playing.
   */
  async setCurrentQueuedTrack(jukeboxId: number, track: QueuedTrackDto): Promise<PlayerStateDto> {
    return await this.updatePlayerState(jukeboxId, {
      queued_track: track,
      spotify_track: track.track,
    })
  }

  /**
   * Change the playback state of the player in spotify, update player state cache.
   */
  async executeAction(jukeboxId: number, action: PlayerActionDto) {
    const { action_type } = action
    const { current_device_id, juke_session_id } = await this.getPlayerState(+jukeboxId)

    if (!current_device_id) {
      throw new BadRequestException('Current device is not set, transfer playback to control audio')
    }
    const activeAccount = await this.accountLinkService.getActiveAccount(jukeboxId)
    const { spotify_account } = activeAccount

    switch (action_type) {
      case ActionType.PLAY:
        await this.spotifyService.startPlayback(spotify_account, current_device_id)
        await this.setIsPlaying(+jukeboxId, true)
        break
      case ActionType.PAUSE:
        await this.spotifyService.pausePlayback(spotify_account, current_device_id)
        await this.setIsPlaying(+jukeboxId, false)
        break
      case ActionType.NEXT:
        if (!juke_session_id) {
          await this.spotifyService.skipNext(spotify_account, current_device_id)
          break
        }

        // Manually skipping: pop immediately (don't wait for threshold)
        this.transitioning.add(jukeboxId)
        let nextTrack: QueuedTrackDto | null = null
        try {
          nextTrack = await this.queueService.popNextTrack(juke_session_id)
        } catch {
          // queue empty
        }

        if (!nextTrack) {
          await this.spotifyService.skipNext(spotify_account, current_device_id)
        } else {
          await this.spotifyService.playTrack(
            spotify_account,
            current_device_id,
            nextTrack.track.spotify_uri,
          )
          await this.setCurrentQueuedTrack(+jukeboxId, nextTrack)
        }
        setTimeout(() => this.transitioning.delete(jukeboxId), 3000)
        break
      case ActionType.PREVIOUS:
        await this.spotifyService.skipPrevious(spotify_account, current_device_id)
        break
      case ActionType.LOOP:
        await this.spotifyService.loopPlayback(spotify_account, current_device_id)
        break
    }

    return this.getPlayerState(jukeboxId)
  }

  /**
   * Spotify is source of truth
   */
  async syncFromSpotify(jukeboxId: number): Promise<PlayerStateDto> {
    const accountLink = await this.accountLinkService.getActiveAccount(jukeboxId)
    const spotify_track = await this.spotifyService.getCurrentTrack(accountLink.spotify_account)
    return await this.setCurrentSpotifyTrack(jukeboxId, spotify_track ?? null)
  }
}
