import { Type } from 'class-transformer'
import { IsNotEmpty, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator'

export class JukeboxSearchDto {
  @IsNotEmpty()
  @IsString()
  trackQuery: string

  @IsOptional()
  @IsString()
  albumQuery: string

  @IsOptional()
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
