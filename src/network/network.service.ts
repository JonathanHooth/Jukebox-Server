import { Injectable } from '@nestjs/common'
import { Axios, AxiosRequestConfig } from 'axios'
import { CLUBS_URL, NODE_ENV } from 'src/config'
import { UserDto } from 'src/shared'
import { sleep } from 'src/utils'

@Injectable()
export class NetworkService {
  protected env = NODE_ENV
  protected routes = {
    getUser: `${CLUBS_URL}/api/v1/user/me/`,
  }
  private token = ''

  constructor(protected axios: Axios) {}

  public sendRequest = async (
    url: string,
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE',
    body?: AxiosRequestConfig['data'],
    config?: Omit<AxiosRequestConfig, 'data'>,
  ) => {
    if (this.env === 'network' || this.env === 'dev') {
      await sleep(1000)
    }

    const res = await this.axios.request({
      method: method || 'GET',
      url,
      headers: {
        Authorization: `Token ${this.token}`,
        'Content-Type': 'application/json',

        ...config?.headers,
      },
      data: body,
      ...config,
    })

    return {
      status: res.status,
      description: res.statusText,
      data: res.data,
    }
  }

  setToken(token: string) {
    this.token = token
  }

  async fetchUser(): Promise<UserDto> {
    const res = await this.sendRequest(this.routes.getUser)

    if (res.status > 299) {
      throw new Error('Error fetching data from network')
    }

    return {
      id: +res.data.id,
      email: res.data.email ?? '',
      username: res.data.username,
    }
  }
}
