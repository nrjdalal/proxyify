import * as cheerio from 'cheerio'
import fetch from 'node-fetch'
import fs from 'fs'

const getData = async (asin, i = 0) => {
  const url = 'localhost:5555'

  try {
    let res = await fetch(`http://${url}/?url=https://amazon.com/dp/${asin}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:104.0) Gecko/20100101 Firefox/104.0',
        Accept: 'text/html,*/*',
        'Accept-Language': 'en- US, en; q=0.5',
        'Accept-Encoding': 'gzip, deflate, br',
        'Content-Type': 'application/json',
        Connection: 'keep-alive',
        Referer: 'https://google.com',
      },
    })

    res = await res.text()
    const $ = cheerio.load(res)
    $.html()

    const data = {
      name: $('#productTitle').text().trim() || $('#btAsinTitle').text().trim(),
      availability: $('#availability').text().trim().replace(/\s+/g, ' '), // availabilty status in alternative
      images: [$('#landingImage').attr('src')],
      total_reviews: Number($('#acrCustomerReviewText').text().split(' ')[0].replace(',', '')),
      average_rating: Number($('span[data-hook=rating-out-of-text]').text().split(' ')[0]),
      notFound:
        $(`img[alt="Sorry! We couldn't find that page. Try searching or go to Amazon's home page."]`).attr('src') ===
        undefined
          ? false
          : true,
      meta: {
        captcha: $('#captchacharacters').attr('placeholder') !== undefined ? true : false,
        index: `${i}`,
        asin,
        url: `https://amazon.com/dp/${asin}`,
      },
    }

    if (data.meta.captcha) {
      console.log(`${data.meta.index} @ ${data.meta.url} ~ Captcha`)
      writer.write(`${data.meta.index} @ ${data.meta.url} ~ Captcha` + '\n')
      getData(asin, i)
    } else if (data.notFound) {
      console.log(`${data.meta.index} @ ${data.meta.url} ~ Not Found`)
      writer.write(`${data.meta.index} @ ${data.meta.url} ~ Not Found` + '\n')
    } else if (data.name.length === 0) {
      console.log(`${data.meta.index} @ ${data.meta.url} ~ Unsuccessful`)
      writer.write(`${data.meta.index} @ ${data.meta.url} ~ Unsuccessful` + '\n')
      getData(asin, i)
    } else {
      console.log(`${data.meta.index}`)
      writer.write(`${data.meta.index}` + '\n')
    }
  } catch {
    getData(asin, i)
  }
}

const asinsTxt = fs.readFileSync('./tests/_asins.txt', 'utf-8')
const asins = asinsTxt.split('\n')

fs.writeFile('./tests/logs.txt', '', (err) => {
  if (err) console.log(err)
})

const writer = fs.createWriteStream(`./tests/logs.txt`, { flags: 'a' })

const timer = (ms) => new Promise((res) => setTimeout(res, ms))

let i = 0

async function load() {
  while (i < asins.length) {
    try {
      getData(asins[i], i)
      await timer(750)
      await timer(Math.floor(Math.random() * 500))
    } catch (e) {
      console.log(e)
    }
    i++
  }
}

load()
