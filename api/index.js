// api/index.js
import { VercelRequest, VercelResponse } from '@vercel/node'

export default function handler(req: VercelRequest, res: VercelResponse) {
  res.json({
    message: "Welcome to my API!",
    endpoints: {
      hello: "/api/hello",
      otherEndpoint: "/api/other-endpoint"
    }
  })
}
