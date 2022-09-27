import * as AWS from '@aws-sdk/client-ec2'

export const ec2Client = new AWS.EC2Client({
  apiVersion: '2016-11-15',
  region: 'us-east-1',
  credentials: {
    accessKeyId: '<Mandatory>',
    secretAccessKey: '<Mandatory>',
  },
})

export const excludeInstance = '<Any-Instance-ID>'

export const instanceParams = (num = 15) => {
  return {
    ImageId: '<Proxy-AMI-Image>',
    InstanceType: 't2.micro',
    KeyName: '<Non-Mandatory>',
    MinCount: num,
    MaxCount: num,
  }
}

export const requestPerProxy = 100
