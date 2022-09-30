import * as cheerio from 'cheerio'
import fetch from 'node-fetch'
import fs from 'fs'

import { api_key } from '../config.js'

// ~ fx -> fetch request with a default timeout of 5s
const fetchTimeout = async (resource, options = {}) => {
  const { timeout = 10000 } = options
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), timeout)
  const response = await fetch(resource, {
    ...options,
    signal: controller.signal,
  })
  clearTimeout(id)
  return response
}

// ~ fx -> get my data
const getData = async (asin, i = 0) => {
  const start = performance.now()
  let url = 'localhost:5555'
  url = '34.233.44.182'

  try {
    let res = await fetchTimeout(
      `http://${url}/?&api_key=${api_key}&autoparse=true&url=https://www.amazon.com/dp/${asin}`
    )

    res = await res.text()

    let data

    data = JSON.parse(res)

    const timeTaken = ((performance.now() - start) / 1000).toFixed(1) + 's'
    if (data.meta.captcha) {
      console.log(`${i} @ https://www.amazon.com/dp/${asin} ~ Captcha ${timeTaken}`)
      await getData(asin, i)
    } else if (data.meta.notFound) {
      console.log(`${i} @ https://www.amazon.com/dp/${asin} ~ Not Found ${timeTaken}`)
    } else if (data.name.length === 0) {
      console.log(`${i} @ https://www.amazon.com/dp/${asin} ~ Unsuccessful ${timeTaken}`)
      await getData(asin, i)
    } else {
      console.log(`${i} ${data.name.slice(0, 4)} ${timeTaken}`)
    }

    if (!data.success) {
      console.log(data)
    }
  } catch {
    await getData(asin, i)
  }
}

const asinsTxt = fs.readFileSync('./tests/_asins.txt', 'utf-8')
const asins = asinsTxt.split('\n')

const timer = (ms) => new Promise((res) => setTimeout(res, ms))

let i = 0

async function load() {
  while (i < asins.length) {
    try {
      getData(asins[i + 90], i)
      await timer(750)
      await timer(Math.floor(Math.random() * 500))
    } catch (e) {
      console.log(e)
    }
    i++
  }
}

load()
