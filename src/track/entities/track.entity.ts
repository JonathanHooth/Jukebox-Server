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

  @Column({ type: 'simple-array' })
  artists: string[]

  @Column()
  spotify_id: string

  @Column()
  spotify_uri: string

  @Column()
  duration_ms: number

  @Column({ nullable: true, type: 'boolean' })
  is_explicit: boolean

  @Column({ nullable: true, type: 'varchar' })
  preview_url: string | null

  @Column({ nullable: true, type: 'varchar' })
  image_url: string | null
}
