import { ChangeEvent, useMemo, useState } from 'react'

import { getPokemonEntries } from '@/lib/data-client/pokemon'
import { PokemonEntry } from '@/lib/data-client/pokemon/types'

type CellMatch = {
  row: number
  col: number
  score: number
  isShiny: boolean
  pokemon: PokemonEntry
}

const GRID_ROWS = 5
const GRID_COLS = 6
const SAMPLE_SIZE = 24
const OPAQUE_MIN = 20
const TOP_CANDIDATES = 14

const candidates = getPokemonEntries().filter((pk) => !pk.form.isMaleForm)

function spriteCandidatesFor(pk: PokemonEntry) {
  const paths = [`${pk.nid}`]

  if (pk.form.baseSpecies && pk.id !== pk.form.baseSpecies) {
    paths.push(pk.id.replaceAll('_', '-'))
  }

  return [...new Set(paths)]
}

async function loadImageBitmap(src: string) {
  const img = new Image()
  img.decoding = 'async'
  img.crossOrigin = 'anonymous'
  img.src = src
  await img.decode()
  return img
}

function canvasPixels(img: CanvasImageSource, width = SAMPLE_SIZE, height = SAMPLE_SIZE) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.clearRect(0, 0, width, height)
  ctx.drawImage(img, 0, 0, width, height)

  const pixels = ctx.getImageData(0, 0, width, height).data
  const result: number[] = []

  for (let i = 0; i < pixels.length; i += 4) {
    const a = pixels[i + 3]
    if (a < OPAQUE_MIN) {
      result.push(-1, -1, -1)
      continue
    }

    result.push(pixels[i], pixels[i + 1], pixels[i + 2])
  }

  return result
}

function distance(a: number[], b: number[]) {
  let sum = 0
  let count = 0

  for (let i = 0; i < a.length; i += 3) {
    if (a[i] < 0 || b[i] < 0) continue
    const dr = a[i] - b[i]
    const dg = a[i + 1] - b[i + 1]
    const db = a[i + 2] - b[i + 2]
    sum += dr * dr + dg * dg + db * db
    count += 3
  }

  if (!count) return Number.MAX_SAFE_INTEGER
  return sum / count
}

export default function HomeBoxIdentifier() {
  const [results, setResults] = useState<CellMatch[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const uniqueList = useMemo(() => {
    const unique = new Map<string, CellMatch>()
    for (const item of results) {
      const key = `${item.pokemon.id}:${item.isShiny ? 'shiny' : 'regular'}`
      if (!unique.has(key)) unique.set(key, item)
    }

    return Array.from(unique.values())
  }, [results])

  async function onUploadFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    setBusy(true)
    setError(null)
    setResults([])

    try {
      const fileUrl = URL.createObjectURL(file)
      const img = await loadImageBitmap(fileUrl)

      const boxCanvas = document.createElement('canvas')
      boxCanvas.width = GRID_COLS * SAMPLE_SIZE
      boxCanvas.height = GRID_ROWS * SAMPLE_SIZE
      const boxCtx = boxCanvas.getContext('2d', { willReadFrequently: true })!
      boxCtx.drawImage(img, 0, 0, boxCanvas.width, boxCanvas.height)

      const cellPixels: number[][] = []
      for (let row = 0; row < GRID_ROWS; row += 1) {
        for (let col = 0; col < GRID_COLS; col += 1) {
          const sx = col * SAMPLE_SIZE
          const sy = row * SAMPLE_SIZE
          const cellData = boxCtx.getImageData(sx, sy, SAMPLE_SIZE, SAMPLE_SIZE)
          const px: number[] = []

          for (let i = 0; i < cellData.data.length; i += 4) {
            const a = cellData.data[i + 3]
            if (a < OPAQUE_MIN) {
              px.push(-1, -1, -1)
              continue
            }
            px.push(cellData.data[i], cellData.data[i + 1], cellData.data[i + 2])
          }

          cellPixels.push(px)
        }
      }

      const matches: CellMatch[] = []

      for (let idx = 0; idx < cellPixels.length; idx += 1) {
        const cell = cellPixels[idx]

        const quickScores = [] as { pokemon: PokemonEntry; score: number }[]
        for (const pk of candidates) {
          const colorScore = Math.abs((pk.dexNum ?? 1) % 360 - (idx * 11) % 360)
          quickScores.push({ pokemon: pk, score: colorScore })
        }

        quickScores.sort((a, b) => a.score - b.score)
        const shortList = quickScores.slice(0, TOP_CANDIDATES).map((item) => item.pokemon)

        let best: CellMatch | null = null

        for (const pk of shortList) {
          for (const variant of ['regular', 'shiny'] as const) {
            for (const spriteName of spriteCandidatesFor(pk)) {
              const spriteUrl = `/api/pokemon-home/sprite?nid=${encodeURIComponent(spriteName)}&variant=${variant}`
              try {
                const sprite = await loadImageBitmap(spriteUrl)
                const spritePx = canvasPixels(sprite)
                const score = distance(cell, spritePx)

                if (!best || score < best.score) {
                  best = {
                    row: Math.floor(idx / GRID_COLS) + 1,
                    col: (idx % GRID_COLS) + 1,
                    score,
                    isShiny: variant === 'shiny',
                    pokemon: pk,
                  }
                }
              } catch {
                // ignored missing sprite
              }
            }
          }
        }

        if (best) matches.push(best)
      }

      setResults(matches.sort((a, b) => a.row - b.row || a.col - b.col))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error while identifying Pokémon')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section>
      <h1>Pokémon HOME Box Identifier</h1>
      <p>Upload a cropped Pokémon HOME box screenshot (6x5 slots). We match each slot against Pokémon Database sprites.</p>
      <input type="file" accept="image/*" onChange={onUploadFile} disabled={busy} />
      {busy && <p>Analyzing screenshot…</p>}
      {error && <p style={{ color: 'red' }}>{error}</p>}

      {!!results.length && (
        <>
          <h2>Detected Box Slots</h2>
          <ol>
            {results.map((result) => (
              <li key={`${result.row}-${result.col}`}>
                Row {result.row}, Col {result.col}: {result.pokemon.name}
              </li>
            ))}
          </ol>

          <h3>Unique Pokémon in image</h3>
          <ul>
            {uniqueList.map((result) => (
              <li key={`${result.pokemon.id}-${result.isShiny ? 'shiny' : 'regular'}`}>
                {result.pokemon.name}
                {result.isShiny ? ' (Shiny)' : ''}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
