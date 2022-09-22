import { ec2Client, excludeInstance, instanceParams, requestPerProxy } from './config.js'
import * as AWS from '@aws-sdk/client-ec2'
import express from 'express'
import fetch from 'node-fetch'
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
await ec2Client.send(new AWS.RunInstancesCommand(instanceParams()))
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
  const proxy = current[i % current.length].PublicIpAddress

  // ~ logging every 10th request
  if (!ready || i % 20 === 0) {
    console.log(i, proxy)
  }

  // ~ checking server status
  if (!ready) {
    try {
      await fetchTimeout(`http://${proxy}/?url=https://google.com`)
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
    await terminateInstances(current.map((el) => el.InstanceId))
    await sleep()
    current = next
    next = []
    create = true
  }

  // ~ main request logic
  try {
    const response = await fetchTimeout(`http://${proxy}/?url=${req.query.url}`)
    res.status(200).send(await response.text())
  } catch {
    res.status(408).send(`Request Timeout!`)
  }

  // ~ create next pool of proxies
  if (create) {
    console.log('Creating proxies!')
    create = false
    await ec2Client.send(new AWS.RunInstancesCommand(instanceParams()))
    await sleep()
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
      await terminateInstances(next.map((el) => el.InstanceId))
      await sleep()
      next = []
      create = true
    }
  }

  res.end()
})

app.listen(5555)
