import type { TestingModule } from '@nestjs/testing'
import { Test } from '@nestjs/testing'
import { TypeOrmModule } from '@nestjs/typeorm'
import { DatabaseModule } from 'src/config/database.module'
import { SpotifyAccount } from 'src/spotify/entities/spotify-account.entity'
import { SpotifyAuthService } from 'src/spotify/spotify-auth.service'
import { MockAxiosProvider } from 'src/utils/mock'
import { AccountLinkService } from '../account-link.service'
import { AccountLink } from '../entities/account-link.entity'

describe('AccountLinkService', () => {
  let service: AccountLinkService

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [DatabaseModule, TypeOrmModule.forFeature([AccountLink, SpotifyAccount])],
      providers: [MockAxiosProvider, AccountLinkService, SpotifyAuthService],
    }).compile()

    service = module.get<AccountLinkService>(AccountLinkService)
  })

  it('should be defined', () => {
    expect(service).toBeDefined()
  })
})
