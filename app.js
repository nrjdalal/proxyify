import { ec2Client, instanceParams, requestPerProxy } from './config.js'
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
  if (allInstances.filter((el) => el.PublicIpAddress === undefined).length !== 0) {
    return await getAll()
  }
  return allInstances
}

// ~ fx -> terminate given instances by instanceIds
const terminateInstances = async (InstanceIds) => {
  return await ec2Client.send(new AWS.TerminateInstancesCommand({ InstanceIds: InstanceIds }))
}

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

// ~ terminating all existing instances
if (allInstances.length !== 0) {
  console.log('terminating all existing instances')
  await terminateInstances(allInstances.map((el) => el.InstanceId))
}

// ~ starting primary instances
console.log('starting primary instances')
await ec2Client.send(new AWS.RunInstancesCommand(instanceParams()))

// ~ associating primary instances with current
let current = await getAll()
console.log(current.map((el) => el.PublicIpAddress))

// ~ variables
let i = 0,
  ready = false,
  create = false,
  next = []

// ~ constants
const switchProxies = current.length * requestPerProxy

app.get('/', async (req, res) => {
  // ~ iterate to next proxy
  i++

  // ~ currently active proxy
  const proxy = current[i % current.length].PublicIpAddress
  console.log(i, proxy)

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
    create = false
    await terminateInstances(current.map((el) => el.InstanceId))
    current = next
    next = []
  }

  // ~ main request logic
  try {
    const response = await fetchTimeout(`http://${proxy}/?url=${req.query.url}`)
    res.status(200).send(await response.text())
  } catch {
    res.status(408).send(`Request Timeout!`)
  }

  // ~ create next pool of proxies
  if (!create) {
    console.log('Creating proxies!')
    create = true
    await ec2Client.send(new AWS.RunInstancesCommand(instanceParams()))
    next = await getAll()
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
      next = []
      create = false
    }
  }

  res.end()
})

app.listen(5555)
