import type { NextApiRequest, NextApiResponse } from 'next'

const HOME_SPRITE_BASE_URL = 'https://img.pokemondb.net/sprites/home'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const nid = typeof req.query.nid === 'string' ? req.query.nid : ''
  const variant = req.query.variant === 'shiny' ? 'shiny' : 'normal'

  if (!nid) {
    return res.status(400).json({ error: 'Missing nid query parameter' })
  }

  const spriteUrl = `${HOME_SPRITE_BASE_URL}/${variant}/${nid}.png`

  try {
    const response = await fetch(spriteUrl)

    if (!response.ok) {
      return res.status(response.status).json({ error: 'Sprite not found' })
    }

    const arrayBuffer = await response.arrayBuffer()

    res.setHeader('Content-Type', 'image/png')
    res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800')
    return res.status(200).send(Buffer.from(arrayBuffer))
  } catch {
    return res.status(502).json({ error: 'Failed to fetch upstream sprite' })
  }
}
