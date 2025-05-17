import type { ExecutionContext } from '@nestjs/common'
import { createParamDecorator, UnauthorizedException } from '@nestjs/common'

export const CurrentUser = createParamDecorator((data: never, context: ExecutionContext) => {
  const request = context.switchToHttp().getRequest()
  const { user } = request

  if (!user) {
    throw new UnauthorizedException()
  }

  return user as IUser
})
