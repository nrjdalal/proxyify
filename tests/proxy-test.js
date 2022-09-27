import * as cheerio from 'cheerio'
import fetch from 'node-fetch'
import fs from 'fs'

const getData = async (asin, i = 0) => {
  const start = performance.now()
  let url = 'localhost:5555'
  url = '34.228.161.158'

  try {
    let res = await fetch(`http://${url}/?url=https://www.amazon.com/dp/${asin}&autoparse=true`)

    res = await res.text()

    let data

    try {
      data = JSON.parse(res)
    } catch {
      const $ = cheerio.load(res)
      $.html()
      data = {
        name: $('#productTitle').text().trim() || $('#btAsinTitle').text().trim(),
        availability_status: $('#availability').text().trim().replace(/\s+/g, ' '), // availabilty status in alternative
        images: [$('#landingImage').attr('src')],
        total_reviews: Number($('#acrCustomerReviewText').text().split(' ')[0].replace(',', '')),
        average_rating: Number($('span[data-hook=rating-out-of-text]').text().split(' ')[0]),
        meta: {
          captcha: $('#captchacharacters').attr('placeholder') !== undefined ? true : false,
          notFound:
            $(`img[alt="Sorry! We couldn't find that page. Try searching or go to Amazon's home page."]`).attr(
              'src'
            ) === undefined
              ? false
              : true,
        },
      }
    }

    const timeTaken = ((performance.now() - start) / 1000).toFixed(1) + 's'
    if (data.meta.captcha) {
      console.log(`${i} @ https://www.amazon.com/dp/${asin} ~ Captcha ${timeTaken}`)
      // writer.write(`${i} @ https://www.amazon.com/dp/${asin} ~ Captcha` + '\n')
      await getData(asin, i)
    } else if (data.meta.notFound) {
      console.log(`${i} @ https://www.amazon.com/dp/${asin} ~ Not Found ${timeTaken}`)
      // writer.write(`${i} @ https://www.amazon.com/dp/${asin} ~ Not Found` + '\n')
    } else if (data.name.length === 0) {
      console.log(`${i} @ https://www.amazon.com/dp/${asin} ~ Unsuccessful ${timeTaken}`)
      // writer.write(`${i} @ https://www.amazon.com/dp/${asin} ~ Unsuccessful` + '\n')
      await getData(asin, i)
    } else {
      console.log(`${i} ${data.name.slice(0, 5)} ${timeTaken}`)
      // writer.write(`${i}` + '\n')
    }
  } catch {
    await getData(asin, i)
  }
}

const asinsTxt = fs.readFileSync('./tests/_asins.txt', 'utf-8')
const asins = asinsTxt.split('\n')

// fs.writeFile('./tests/logs.txt', '', (err) => {
//   if (err) console.log(err)
// })

// const writer = fs.createWriteStream(`./tests/logs.txt`, { flags: 'a' })

const timer = (ms) => new Promise((res) => setTimeout(res, ms))

let i = 0

async function load() {
  while (i < asins.length) {
    try {
      getData(asins[i], i)
      await timer(1000)
      // await timer(Math.floor(Math.random() * 500))
      // await Promise.all([
      //   getData(asins[i + 0], i + 0),
      //   getData(asins[i + 1], i + 1),
      //   getData(asins[i + 2], i + 2),
      //   getData(asins[i + 3], i + 3),
      //   getData(asins[i + 4], i + 4),
      //   getData(asins[i + 0], i + 5),
      //   getData(asins[i + 1], i + 6),
      //   getData(asins[i + 2], i + 7),
      //   getData(asins[i + 3], i + 8),
      //   getData(asins[i + 4], i + 9),
      // ])
    } catch (e) {
      console.log(e)
    }
    i++
    // i = i + 10
  }
}

load()
