import { Type } from 'class-transformer'
import { IsNotEmpty, IsNumber, IsString, Max, Min } from 'class-validator'

export class JukeboxSearchDto {
  @IsNotEmpty()
  @IsString()
  trackQuery: string

  @IsNotEmpty()
  @IsString()
  albumQuery: string

  @IsNotEmpty()
  @IsString()
  artistQuery: string
}

export class TrackSearchPageDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  page: number

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(50)
  row: number
}
