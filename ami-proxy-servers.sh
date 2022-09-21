#!/bin/bash
sudo apt update
sudo apt upgrade -y
# installing caddy
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install caddy -y
# installing node
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt-get install -y nodejs
sudo ln -s /usr/bin/nodejs /usr/bin/node
# installing yarn and pm2
sudo npm -g i yarn
sudo npm -g i pm2
# configuring proxy
mkdir -p ~/aws
cd ~/aws
npm init es6 -y
yarn add express node-fetch
cat >index.js <<INDEX
import express from 'express'
import fetch from 'node-fetch'
const app = express()
const port = 3000
app.get('/', async (req, res) => {
  await fetch(req.query.url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:104.0) Gecko/20100101 Firefox/104.0',
      Accept: 'text/html,*/*',
      'Accept-Language': 'en- US, en; q=0.5',
      'Accept-Encoding': 'gzip, deflate, br',
      'Content-Type': 'application/json',
      Connection: 'keep-alive',
      Referer: 'https://google.com',
    },
  }).then(async (response) => {
    res.status(200).send(await response.text())
  })
})
app.listen(port)
INDEX
# configuring pm2
pm2 startup
pm2 start index.js -n proxy
pm2 save
# configuring caddy
cat >/etc/caddy/Caddyfile <<CADDYFILE
:80 {
  reverse_proxy localhost:3000
}
CADDYFILE
sudo systemctl reload caddy
