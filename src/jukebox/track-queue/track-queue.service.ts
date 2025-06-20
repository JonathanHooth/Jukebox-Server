import { CACHE_MANAGER } from '@nestjs/cache-manager'
import { Inject, Injectable } from '@nestjs/common'
import { Cache } from 'cache-manager'
import { randomUUID } from 'crypto'

export class QueueItem<T = unknown> {
  recommended_by: string
  constructor(public item: T) {}
}


export class Queue<T = unknown> {
  constructor(readonly items: QueueItem<T>[]) {}

  // Pushes a track to the end of the queue and returns the new length
  public push(track: T): number {
    this.items.push(new QueueItem(track))
    return this.items.length
  }

  // Pops a track from the front of the queue
  public pop(): T | undefined {
    if (this.items.length === 0) return undefined
    const target = this.items.shift() // Remove the first item
    return target ? target.item : undefined // Return the track or undefined if the queue was empty
  }

  // Peeks at the track at the front of the queue without removing it
  public peek(offset = 0): T | undefined {
    const target = this.items[offset]
    return target ? target.item : undefined // Return the track or undefined if the queue is empty
  }

  public list(): T[] {
    return this.items.map((item) => item.item)
  }

  public remove(pos: number): QueueItem<T>[] | undefined {
    if (this.items.length === 0 || pos < 0) return undefined
    const target = this.items.splice(pos, 1)
    return target.length > 0 ? target : undefined
  }

  // Moves a track to a new position in the queue
  public setPosition(track: T, pos: number) {
    const currentIndex = this.items.findIndex((target) => target.item === track)
    if (currentIndex === -1) {
      throw new Error('Track not found')
    }

    // Remove the track from its current position
    const [removedTrack] = this.items.splice(currentIndex, 1)

    // Ensure the new position is within bounds
    pos = Math.max(0, Math.min(pos, this.items.length))

    // Insert the track at the new position
    this.items.splice(pos, 0, removedTrack)
  }

  public getTrack(pos: number) {
    if(pos >= this.items.length)
    {
      return -1
    }
    return this.items[pos]
  }

  public update(pos: number, fields: Partial<T>) {
    if (this.items.length <= pos) return
    this.items[pos] = { ...this.items[pos], ...fields }

    return this.items[pos]
  }
  
  public size() {
    return this.items.length
  }

  public findElement(elementType: keyof T, targetElement){
    for (let i = 0; i < this.items.length; i++) {
      const item = this.items[i]
      if (item.item[elementType] === targetElement) {
        return i
      }
    }

    return -1
  }

}
type TrackQueue = Queue<IQueuedTrack>
type TrackQueueItem = QueueItem<IQueuedTrack>

@Injectable()
export class TrackQueueService {
  private cacheTtlSec = 600

  constructor(@Inject(CACHE_MANAGER) private cache: Cache) {}

  private getCacheKey(jukeboxId: number, label: 'queue' | 'currently-playing') {
    return `${label}-${jukeboxId}`
  }

  private async getCachedQueue(jukeboxId: number) {
    const key = this.getCacheKey(jukeboxId, 'queue')
    const tracks = (await this.cache.get<TrackQueueItem[] | undefined>(key)) ?? []
    return new Queue(tracks)
  }

  private async commitQueue(jukeboxId: number, queue: TrackQueue) {
    const key = this.getCacheKey(jukeboxId, 'queue')
    await this.cache.set(key, queue.items, this.cacheTtlSec)
  }

  // private async getCachedPlayerState(jukeboxId: number): Promise<PlayerStateDto | null> {
  //   const key = this.getCacheKey(jukeboxId, 'currently-playing')
  //   const playing = await this.cache.get<PlayerStateDto | undefined>(key)

  //   return playing ?? null
  // }

  // private async commitPlayerState(jukeboxId: number, playerState: PlayerStateDto) {
  //   const key = this.getCacheKey(jukeboxId, 'currently-playing')
  //   await this.cache.set(key, playerState, this.cacheTtlSec)
  // }

  /**
   * Get next tracks in queue, excludes current track
   */
  public async getTrackQueue(jukeboxId: number) {
    const queue = await this.getCachedQueue(jukeboxId)
    return queue.list()
  }

  public async queueTrack(
    jukeboxId: number,
    track: ITrackDetails,
    recommended_by?: string,
    position = -1,
  ): Promise<IQueuedTrack> {
    const queue = await this.getCachedQueue(jukeboxId)
    const updatedTrack: IQueuedTrack = {
      track,
      queue_id: randomUUID(),
      recommended_by,
      spotify_queued: false,
      interactions: { likes: 0, dislikes: 0 },
    }

    queue.push(updatedTrack)
    if (position >= 0) {
      queue.setPosition(updatedTrack, position)
    }

    await this.commitQueue(jukeboxId, queue)
    return updatedTrack
  }

  public async popTrack(jukeboxId: number): Promise<IQueuedTrack | null> {
    const queue = await this.getCachedQueue(jukeboxId)
    const track: IQueuedTrack | null = queue.pop() ?? null

    await this.commitQueue(jukeboxId, queue)
    return track
  }

  public async peekNextTrack(jukeboxId: number): Promise<IQueuedTrack | null> {
    const queue = await this.getCachedQueue(jukeboxId)
    return queue.peek() ?? null
  }

  public async queueIsEmpty(jukeboxId: number): Promise<boolean> {
    const queue = await this.getCachedQueue(jukeboxId)
    return queue.list().length === 0
  }

  public async getTrackAtPos(jukeboxId: number, pos: number) {
    const queue = await this.getCachedQueue(jukeboxId)
    if (queue.list().length <= pos) {
      return null
    }

    return queue.list()[pos]
  }

  public async setTrackAtPos(jukeboxId: number, track: IQueuedTrack, pos: number) {
    const queue = await this.getCachedQueue(jukeboxId)
    if (queue.list().length <= pos) {
      throw new Error(`Track queue pos out of bounds, pos ${pos} > length ${queue.list().length}`)
    }

    queue[pos] = track
    await this.commitQueue(jukeboxId, queue)
  }

  // public async getPlayerState(jukeboxId: number): Promise<PlayerStateDto | null> {
  //   return await this.getCachedPlayerState(jukeboxId)
  // }

  // public async setPlayerState(jukeboxId: number, playerState: PlayerStateDto | null) {
  //   return await this.commitPlayerState(jukeboxId, playerState)
  // }

  // /**
  //  * Get track queue.
  //  * If empty, returns default next tracks defined
  //  * in the current player state, which represents what's
  //  * automatically next up in Spotify's queue.
  //  */
  // public async getTrackQueueOrDefaults(jukeboxId: number) {
  //   let queued: IQueuedTrack[] = await this.getTrackQueue(jukeboxId)
  //   if (queued && queued.length === 0) {
  //     const playerState = await this.getPlayerState(jukeboxId)

  //     queued = playerState?.default_next_tracks.map((track) => ({
  //       ...track,
  //       queue_id: randomUUID(),
  //     }))
  //   }

  //   return queued || []
  // }

  public async flagNextTrackAsQueued(jukeboxId: number) {
    const nextTrack = await this.peekNextTrack(jukeboxId)
    if (!nextTrack) return

    const queue = await this.getCachedQueue(jukeboxId)
    queue.update(0, { spotify_queued: true })
    await this.commitQueue(jukeboxId, queue)
  }

  public async clearQueue(jukeboxId: number) {
    const queue = new Queue<IQueuedTrack>([])
    await this.commitQueue(jukeboxId, queue)
  }

  // public async updatePlayerState(jukeboxId: number, cb: (state: PlayerStateDto) => PlayerStateDto) {
  //   const playerState = await this.getPlayerState(jukeboxId)
  //   const updatedState = cb(playerState)
  //   await this.commitPlayerState(jukeboxId, updatedState)

  //   return updatedState
  // }

  public async clearSong(jukeboxId: number, queueId: string): Promise<QueueItem<IQueuedTrack>[] | undefined> {
    const queue = await this.getCachedQueue(jukeboxId)

    if (queue.size() < 0) {
      return undefined
    }

    const queuePos: number = queue.findElement('queue_id', queueId)
    if (queuePos === -1) {
      return undefined
    }

    const removed: QueueItem<IQueuedTrack>[] | undefined = queue.remove(queuePos)

    await this.commitQueue(jukeboxId, queue)

    return removed
  }

  public async swapSong(jukeboxId: number, targetPos:number, currentPos: number ):Promise<number>
  {
    console.log(`${currentPos} to ${targetPos}`)
    const queue = await this.getCachedQueue(jukeboxId)

    if (queue.size() < 0) {
      return -1
    }

    if (targetPos < 0 || currentPos < 0 || targetPos === currentPos) {
      return -1
    }

    const queuedTrack = queue.getTrack(currentPos)
    
    if(queuedTrack === -1)
    {
      return -1
    }
    queue.setPosition(queuedTrack.item, targetPos)

    await this.commitQueue(jukeboxId, queue)
    
    return queue.size()
  }
}
