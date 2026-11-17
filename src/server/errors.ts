export class HttpError extends Error {
  readonly statusCode: number
  readonly code: string
  readonly fields?: Record<string, string>

  constructor(statusCode: number, code: string, message: string, fields?: Record<string, string>) {
    super(message)
    this.name = 'HttpError'
    this.statusCode = statusCode
    this.code = code
    this.fields = fields
  }
}