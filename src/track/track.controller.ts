import { Body, Controller, Get, NotImplementedException, Query, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger'
import { JukeboxSearchDto } from 'src/jukebox/dto/jukebox-search.dto'
import { Roles } from 'src/utils/decorators/roles.decorator'
import { RolesGuard } from 'src/utils/guards/roles.guard'
import { TrackService } from './track.service'
import { MaxInt } from '@spotify/web-api-ts-sdk'

@ApiTags('Track')
@ApiBearerAuth()
@Controller('track/tracks/')
export class TrackController {
  constructor(private readonly trackService: TrackService) {}

  @Roles('member')
  @UseGuards(RolesGuard)
  @Get()
  @ApiOperation({ summary: '[MEMBER] Search tracks from the Spotify API' })
  @ApiQuery({ name: 'trackQuery', required: false, schema: { type: 'string', default: '' } })
  @ApiQuery({ name: 'albumQuery', required: false, schema: { type: 'string', default: '' } })
  @ApiQuery({ name: 'artistQuery', required: false, schema: { type: 'string', default: '' } })
  @ApiQuery({ name: 'page', required: false, type: Number, schema: { default: 0, minimum: 0 } })
  @ApiQuery({ name: 'rows', required: false, type: Number, schema: { default: 10, minimum: 1 } })
  searchTracks(
    @Query('jukeboxId') jukeboxId: string,
    @Query('trackQuery') trackQuery: string = '',
    @Query('albumQuery') albumQuery: string = '',
    @Query('artistQuery') artistQuery: string = '',
    @Query('page') page: number,
    @Query('rows') row: number,
  ) {
    return this.trackService.searchTracks(
      +jukeboxId,
      { trackQuery, albumQuery, artistQuery },
      { page, row },
    )
  }
}
