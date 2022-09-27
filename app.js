import { ec2Client, excludeInstance, instanceParams, requestPerProxy } from './config.js'
import * as AWS from '@aws-sdk/client-ec2'
import * as cheerio from 'cheerio'
import express from 'express'
import fetch from 'node-fetch'
import HttpsProxyAgent from 'https-proxy-agent'

const app = express()

// ~ fx -> get all pending and running instances
const getAll = async () => {
  const describeAll = await ec2Client.send(new AWS.DescribeInstancesCommand({}))
  let allInstances = []
  describeAll.Reservations.forEach((el) => allInstances.push(...el.Instances))
  allInstances = allInstances
    .map((el) => {
      return {
        InstanceId: el.InstanceId,
        PublicIpAddress: el.PublicIpAddress,
        State: el.State,
        Meta: { Info: el },
      }
    })
    .filter((el) => el.State.Name !== 'shutting-down')
    .filter((el) => el.State.Name !== 'terminated')
    .filter((el) => el.State.Name !== 'stopping')
    .filter((el) => el.State.Name !== 'stopped')
    .filter((el) => el.InstanceId !== excludeInstance)
  if (allInstances.filter((el) => el.PublicIpAddress === undefined).length !== 0) {
    return await getAll()
  }
  return allInstances
}

// ~ fx -> terminate given instances by instanceIds
const terminateInstances = async (InstanceIds) => {
  return await ec2Client.send(new AWS.TerminateInstancesCommand({ InstanceIds: InstanceIds }))
}

// ~ fx -> create new instances
const createInstances = async (instanceParams) => {
  const describeAll = await ec2Client.send(new AWS.DescribeInstancesCommand({}))
  let allInstances = []
  describeAll.Reservations.forEach((el) => allInstances.push(...el.Instances))
  allInstances = allInstances
    .map((el) => {
      return {
        InstanceId: el.InstanceId,
        PublicIpAddress: el.PublicIpAddress,
        State: el.State,
        Meta: { Info: el },
      }
    })
    .filter((el) => el.State.Name === 'shutting-down')
  if (allInstances.length !== 0) {
    return await createInstances(instanceParams)
  }
  return await ec2Client.send(new AWS.RunInstancesCommand(instanceParams))
}

// ~ fx -> sleep
const sleep = (ms = 1000) => new Promise((res) => setTimeout(res, ms))

// ~ fx -> fetch request with a default timeout of 5s
const fetchTimeout = async (resource, options = {}) => {
  const { timeout = 15000 } = options
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), timeout)
  const response = await fetch(resource, {
    ...options,
    signal: controller.signal,
  })
  clearTimeout(id)
  return response
}

// ~ getting all pending and running instances
console.log('getting all pending and running instances')
const allInstances = await getAll()
await sleep()

// ~ terminating all existing instances
if (allInstances.length !== 0) {
  console.log('terminating all existing instances')
  await terminateInstances(allInstances.map((el) => el.InstanceId))
  await sleep()
}

// ~ starting primary instances
console.log('starting primary instances')
// await ec2Client.send(new AWS.RunInstancesCommand(instanceParams()))
await createInstances(instanceParams())
await sleep()

// ~ associating primary instances with current
let current = await getAll()
await sleep()
console.log(current.map((el) => el.PublicIpAddress))

// ~ variables
let i = 0,
  ready = false,
  create = true,
  next = []

// ~ constants
const switchProxies = current.length * requestPerProxy

app.get('/', async (req, res) => {
  // ~ iterate to next proxy
  i++

  // ~ currently active proxy

  // ~ logging every 20th request
  if (!ready || i % 20 === 0) {
    console.log(i, current[i % current.length].PublicIpAddress)
  }

  // ~ checking server status
  if (!ready) {
    if (i === 10) {
      i = 0
    }
    try {
      const proxyAgent = new HttpsProxyAgent(`http://${current[i % current.length].PublicIpAddress}:3128`)
      await fetchTimeout('https://google.com', { agent: proxyAgent })
      ready = true
      i = 0
      res.send('Server is ready!')
      return
    } catch {
      res.send('Server is booting up!')
      return
    }
  }

  // ~ proxy pool switcher before proceeding to next request i.e. next -> current
  if (i % switchProxies === 0) {
    console.log('Switching proxies!')
    terminateInstances(current.map((el) => el.InstanceId))
    current = next
    next = []
    create = true
  }

  const proxy = current[i % current.length].PublicIpAddress

  // ~ main request logic
  try {
    const proxyAgent = new HttpsProxyAgent(`http://${proxy}:3128`)
    const response = await fetchTimeout(req.query.url, {
      agent: proxyAgent,
      headers: {
        Accept: 'text/html,*/*',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:105.0) Gecko/20100101 Firefox/105.0',
      },
      timeout: 15000,
    })
    if (res.query.url.contains('amazon')) {
      response = await response.text()
      const $ = cheerio.load(response)
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

      res.status(200).json({
        name: data.name,
        // product_information: {},
        // brand: '',
        // brand_url: null,
        // full_description: '',
        // pricing: '',
        // list_price: '',
        availability_status: data.availability,
        images: data.images,
        // product_category: '',
        average_rating: data.average_rating,
        // small_description: '',
        // feature_bullets: [],
        total_reviews: data.total_reviews,
        // total_answered_questions: 0,
        // customization_options: {},
        // seller_id: null,
        // seller_name: null,
        // fulfilled_by_amazon: null,
        // fast_track_message: '',
        // aplus_present: false,
      })
    } else res.status(200).send(await response.text())
  } catch {
    res.status(408).send(`Request Timeout!`)
  }

  // ~ create next pool of proxies
  if (create) {
    console.log('Creating proxies!')
    create = false
    try {
      // await ec2Client.send(new AWS.RunInstancesCommand(instanceParams()))
      await createInstances(instanceParams())
      await sleep()
    } catch {
      console.log('Retry later!')
    }
    next = await getAll()
    await sleep()
    next = next.map((el) => {
      let flag = 0
      current.forEach((id) => {
        if (id.InstanceId === el.InstanceId) {
          flag = 1
        }
      })
      if (!flag) {
        return el
      }
    })
    next = next.filter((el) => el !== undefined)
    console.log(
      'Current',
      current.map((el) => el.PublicIpAddress)
    )
    console.log(
      'Next',
      next.map((el) => el.PublicIpAddress)
    )
    if (current.length !== next.length) {
      try {
        await terminateInstances(next.map((el) => el.InstanceId))
      } catch {
        console.log('No instances to remove!')
      }
      await sleep()
      next = []
      create = true
    }
  }
  res.end()
})

app.listen(5555)
