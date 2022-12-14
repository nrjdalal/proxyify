import { api_key, ec2Client, excludeInstance, instanceParams, requestPerProxy } from './config.js'
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

// ~ variables
let i = 0,
  create = true,
  current = [],
  init = true,
  next = [],
  ready = false,
  switchProxies

app.get('/', async (req, res) => {
  if (req.query.api_key !== api_key) {
    res.status(408).json({ success: false, reason: 'Access denied!' })
    return
  }

  if (current.length === 0) {
    res.status(408).json({ success: false, reason: 'Initializing!' })
  }

  if (init === true && current.length === 0) {
    // ~ switch the flag and create instances in background
    init = false

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
    current = await getAll()
    await sleep()
    console.log(current.map((el) => el.PublicIpAddress))

    switchProxies = current.length * requestPerProxy
    init = true
    return
  }

  // ~ don't proceed furthur without creating primary
  if (current.length === 0) {
    return
  }

  // ~ iterate to next proxy
  i++

  // ~ logging every request
  if (!ready || i % current.length === 0) {
    console.log(
      i,
      current[i % current.length].PublicIpAddress.split('.')[3],
      req.headers.host,
      Array.isArray(req.query.url.match(/[A-Z0-9]{10}/)) ? req.query.url.match(/[A-Z0-9]{10}/)[0] : false
    )
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

      return res.status(404).json({ success: false, reason: 'Server is ready!' })
    } catch {
      return res.status(404).json({ success: false, reason: 'Server is booting up!' })
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
    let response = await fetchTimeout(req.query.url, {
      agent: proxyAgent,
      headers: {
        Accept: 'text/html,*/*',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:105.0) Gecko/20100101 Firefox/105.0',
      },
    })
    if (req.query.url.includes('amazon') && req.query.autoparse === 'true') {
      response = await response.text()
      const $ = cheerio.load(response)
      let data = {
        name: $('#productTitle').text().trim() || $('#btAsinTitle').text().trim(),
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

      data = {
        success: data.meta.captcha !== true && data.meta.notFound !== true && data.name.length === 0 ? false : true,
        availability_status:
          data.meta.notFound === true ? '404' : $('#availability').text().trim().replace(/\s+/g, ' '),
        ...data,
      }

      res.status(200).json(data)
    } else res.status(200).send(await response.text())
  } catch {
    res.status(408).json({ success: false, reason: 'Something went wrong!' })
  }

  // ~ create next pool of proxies
  if (create) {
    create = false
    await sleep()
    console.log('Creating proxies!')
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
})

app.listen(5555)
