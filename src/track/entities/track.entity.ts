import { EntityBase } from 'src/config/entities'
import { Column, Entity } from 'typeorm'

@Entity('track')
export class Track extends EntityBase {
  @Column()
  name: string

  @Column()
  album: string

  @Column()
  release_year: number

  @Column()
  artists: string

  @Column()
  spotify_id: string

  @Column()
  spotify_uri: string
}
