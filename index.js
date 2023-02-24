require('log-timestamp')(function () {
  return `[${new Date().toISOString().
    replace(/T/, ' ').      // replace T with a space
    replace(/\..+/, '')     // delete the dot and everything after
    }] %s`
});
require('dotenv').config();

const chalk = require('chalk')
const http = require('http')
const https = require('https')
const sqlite3 = require('sqlite3').verbose()
const url = require('url')
const process = require('process')

const db = new sqlite3.Database('./data/memory.db')

const C = 451.14021301

const hostuser = process.env.PB_HOSTUSER
const hostpass = process.env.PB_HOSTPASS
const hostname = process.env.PB_HOSTNAME
const hostport = process.env.PB_HOSTPORT || 443
const hostpath = process.env.PB_HOSTPATH || '/'
const DBG = process.env.PB_DEBUG

const localport = process.env.PB_LOCALPORT || 19922

if (hostname === undefined) {
  console.error(chalk.red('ERROR: Environment variable HOSTNAME is empty.'))
  process.exit(1)
}

const httpsOptions = {
  hostname: hostname,
  port: hostport,
  basePath: hostpath,
  method: 'GET'
}

let LAST_SUCCESS = false

const validateUrl = (value) => {
  return /^(?:(?:(?:https?|ftp):)?\/\/)(?:\S+(?::\S*)?@)?(?:(?!(?:10|127)(?:\.\d{1,3}){3})(?!(?:169\.254|192\.168)(?:\.\d{1,3}){2})(?!172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2})(?:[1-9]\d?|1\d\d|2[01]\d|22[0-3])(?:\.(?:1?\d{1,2}|2[0-4]\d|25[0-5])){2}(?:\.(?:[1-9]\d?|1\d\d|2[0-4]\d|25[0-4]))|(?:(?:[a-z\u00a1-\uffff0-9]-*)*[a-z\u00a1-\uffff0-9]+)(?:\.(?:[a-z\u00a1-\uffff0-9]-*)*[a-z\u00a1-\uffff0-9]+)*(?:\.(?:[a-z\u00a1-\uffff]{2,})))(?::\d{2,5})?(?:[/?#]\S*)?$/i.test(value)
}

const sqlGet = async (query, params) => new Promise((resolve, reject) => {
  const stmt = db.prepare(query)
  stmt.all(params, (err, rows) => {
    stmt.finalize()
    if (err) { return reject(err) }
    if (rows.length === 1) {
      return resolve(rows[0])
    } else {
      return resolve(rows)
    }
  })
})

const sqlPut = async (query, params) => new Promise((resolve, reject) => {
  const stmt = db.prepare(query)
  stmt.run(params, (err) => {
    stmt.finalize()
    if (err) { return reject(err) }
    return resolve()
  })
})

const dupUrl = async (url) => ((await sqlGet('SELECT COUNT(*) as n FROM urls WHERE url=?', url)).n) > 0
const countUrls = async () => (await sqlGet('SELECT COUNT(*) as n FROM urls WHERE forwarded_date is null', url)).n

function timeout(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
async function sleep(fn, duration, ...args) {
  await timeout(duration);
  return fn(...args);
}

const storeURL = async (url) => {
  if (!validateUrl(url)) {
    console.error(chalk.red(`storeURL() Invalid url: ${url} `))
    return { err: 'INV_URL' }
  }
  if (await dupUrl(url)) {
    console.error(chalk.red(`storeURL Duplicate url: ${url} `))
    return { err: 'DUP_URL' }
  }

  await sqlPut('INSERT INTO urls (url) VALUES (?)', url)
  console.info(chalk.green(`storeURLAdding url: ${url} `))

  return { id: 0 }
}

// This returns values along a bell curve from 0 - 1 - 0 with an input of 0 - 1.
function toBell(x, scale) {
  scale = scale || false
  var stdD = 0.125
  var mean = 0.5
  if (scale) {
    return 1 / ((1 / (stdD * Math.sqrt(2 * Math.PI))) * Math.pow(Math.E, -1 * Math.pow(x - mean, 2) / (2 * Math.pow(stdD, 2))))
  } else {
    return ((1 / (stdD * Math.sqrt(2 * Math.PI))) * Math.pow(Math.E, -1 * Math.pow(x - mean, 2) / (2 * Math.pow(stdD, 2)))) * toBell(0.5, true)
  }
}

// Minutes since midnight
const msm = () => {
  const now = new Date()
  const then = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    0, 0, 0)
  return Math.floor((now.getTime() - then.getTime()) / 60000) // difference in minutes
}

const REG = async (req, res) => {
  const queryObject = url.parse(req.url, true).query
  const storeRes = await storeURL(queryObject.url)
  if (storeRes.err === undefined) {
    return res.end(`OK: ${storeRes.id} `)
  } else {
    return res.end(`FAIL: ${storeRes.err} `)
  }
}

const FWD = async (req, res) => {
  console.log('FWD')
  await repost(1)
}

const STA = async (req, res) => {
  const sqlResSta = await sqlGet('select date, "avg rand", "sum wprob", "post count" from (select 1 as \'#\', strftime(\'%Y-%m-%d\', t) date, avg(random_value) as \'avg rand\', sum(wprob) \'sum wprob\', sum(case when random_value < wprob then 1 else 0 end) as \'post count\' from cron_log group by strftime(\'%j\', t)  union select 2, \'---\', \'---\',\'---\', \'-------\' from cron_log union select 3, \'sum\' as date, avg(random_value) as \'avg rand\', sum(wprob) wprob, sum(case when random_value < wprob then 1 else 0 end) as \'post count\' from cron_log union select 4, \'unposted\', strftime(\'%Y%m%d %H:%M\', datetime()) now, \'\', count(*) from urls where forwarded_date is null) order by "#"')
  if (sqlResSta !== undefined) {
    return res.end(`STA: \n${JSON.stringify(sqlResSta, 2)} \n\n`)
  } else {
    return res.end('FAIL: Error when quering database.')
  }
}

const LST = async (req, res) => {
  const sqlResLst = await sqlGet('select * from urls')
  if (sqlResLst !== undefined) {
    return res.end(`LST: \n${JSON.stringify(sqlResLst, 2)} \n\n`)
  } else {
    return res.end('FAIL: Error when quering database.')
  }
}

const requestHandler = async (req, res) => {
  switch (req.url.substr(0, 4)) {
    case '/REG':
      return await REG(req, res)
    case '/FWD':
      return await FWD(req, res)
    case '/STA':
      return await STA(req, res)
    case '/LST':
      return await LST(req, res)
    default:
      return res.end('UNK: ' + Math.floor(Math.random() * 10000000).toString(16))
  }
}

// DO REQUEST TO THE REAL TARGET
const repost = async (depth = 1) => {
  LAST_SUCCESS = false
  if (depth > 100) {
    console.warn('repost(): Depth above 100, unwinding recursive loop.', depth)
    LAST_SUCCESS = true
    return false
  }

  const urlData = await sqlGet('SELECT id, url from urls where forwarded_date is null order by added_date limit 1')
  if (urlData == undefined) {
    console.warn('repost(): urlData is undefined, retrying.', depth)
    await sleep(repost, 1000, ++depth)
    // await repost(++depth)
    LAST_SUCCESS = false
    return false
  }

  console.info(chalk.blueBright('Repost: ', urlData.url))

  await sqlPut('UPDATE urls SET forwarded_date=? WHERE id=?', ['PROCESSING', urlData.id])

  // Use user+pass if provided
  if (hostuser !== undefined && hostpass !== undefined) {
    httpsOptions.headers = {
      Authorization: 'Basic ' + Buffer.from(hostuser + ':' + hostpass).toString('base64')
    }
  }

  if (urlData.url === undefined) {
    console.debug(urlData)
    console.error(chalk.red('ERROR: urlData.url is undefined.'))
    await sqlPut('UPDATE urls SET forwarded_date=? WHERE id=?', ['BROKEN', urlData.id])

    LAST_SUCCESS = true
    return false
  }

  httpsOptions.path = httpsOptions.basePath + encodeURIComponent(urlData.url)
  const req = https.request(httpsOptions, (res) => {
    res.setEncoding('utf8')
    if (res.statusCode === 415 || res.statusCode === '415') { // Unsupported filetype
      sqlPut('UPDATE urls SET forwarded_date=? WHERE id=?', [res.statusMessage.toString(), urlData.id])
      console.warn(chalk.yellow(`WARN: ${res.statusMessage} (${urlData.id} marked as error).`))
      LAST_SUCCESS = false
      return false
    } else if (res.statusCode === 460) {
      console.info(chalk.whiteBright(`INFO: ${res.statusCode} (${urlData.id} marked as dupe).`))
      sqlPut('UPDATE urls SET forwarded_date=? WHERE id=?', ['DUPE', urlData.id])
      LAST_SUCCESS = false
      return false
    } else if (res.statusCode !== 200 && res.statusCode !== 302) { // Not ok
      if (res.statusMessage.toString() === 'Found') { // but ok anyway
        sqlPut('UPDATE urls SET forwarded_date=datetime(\'now\') WHERE id=?', urlData.id)
        if (DBG) {
          console.info(`INFO: OK ${res.statusCode} '${urlData.id}'`)
        }
        LAST_SUCCESS = true
        return true
      } else {
        LAST_SUCCESS = false
        sqlPut('UPDATE urls SET forwarded_date=? WHERE id=?', [null, urlData.id])
        console.error(`Error: ${res.statusCode} '${res.data}'`)
        return false
      }
    }

    console.info(`INFO: OK ${res.statusCode} '${urlData.id}'`)
    sqlPut('UPDATE urls SET forwarded_date=datetime(\'now\') WHERE id=?', urlData.id)
    LAST_SUCCESS = true
  })

  req.on('error', async (error) => {
    if (error.toString() === 'Gateway Time-out' || error.toString() === 'Found') {
      console.warn(chalk.yellow(`WARN: ${error} (${urlData.id} marked as completed anyway).`))
      await sqlPut('UPDATE urls SET forwarded_date=datetime(\'now\') WHERE id=?', urlData.id)
      LAST_SUCCESS = true
      return true
    } else {
      console.error(`repost() ERROR: req.on('error'): '${error.toString()}`)
      LAST_SUCCESS = false
      return false
    }
  })

  req.end()
}

const cronHandler = async () => {
  // if (cronHandle._idleNext !== null) { clearTimeout(cronHandle) }

  // Curve: https://www.wolframalpha.com/input/?i=tanh%28x*2.5+%2F+200%29+*+50+for+0+to+300
  const prob = toBell(msm() / 1440) / (C) // Bellcurve spreading prob over 1440 minutes so the sum of all probs is 1 thanks to magic constant C = 451.14021301
  const newUrlCount = await countUrls()
  const M = 1500 // Max - where should the curve plane out, not really but a nice good number to get it to plane out around 50 posts a day
  const DAM = 30 // Daily at Max - how many posts per day at M (not exact science, becomes ~50 with the above M)
  const weight = (Math.tanh(newUrlCount / M) * DAM) // tanh curve above
  const wprob = prob * weight
  const r = Math.random()

  // console.log(`cronHandler> msm: ${msm()} r: ${r} newUrlCount: ${newUrlCount} wprob: ${wprob} RUN?=${r < wprob}`)
  await sqlPut('INSERT INTO cron_log (msm, url_count, random_value, weight, wprob) VALUES (?,?,?,?,?)', [msm(), newUrlCount, r, weight, wprob])

  if (r < wprob || !LAST_SUCCESS) {
    LAST_SUCCESS = false
    await repost(0)
  }

  const sleepTime = (60000 + (Math.random() - 0.5) * (30000))
  if (DBG) {
    console.log(chalk.green(`Sleeping for ${Math.round(sleepTime / 1000)}s`))
  }
  sleep(cronHandler, sleepTime)
}

async function main() {
  console.info(chalk.green('Start'))

  await db.exec(`CREATE TABLE IF NOT EXISTS urls (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            url TEXT not null,
            added_date timestamp default current_timestamp,
            forwarded_date timestamp default null
        );
        create table if not exists cron_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            t timestamp default current_timestamp,
            msm int,
            url_count int,
            random_value float,
            weight float,
            wprob float
        )`)

  console.log(chalk.blueBright('Created / verified db'))

  await server.listen(localport)
  console.info(chalk.green(`Server listening on port ${localport}`))
  console.info(chalk.gray(`Host target: https://${hostuser}:${hostpass}@${hostname}:${hostport}${hostpath}`))

  console.log(chalk.green('Starting cronHandler'))
  // cronHandle = setTimeout(await cronHandler, 10)
  sleep(cronHandler, 10)
}

const server = http.createServer(requestHandler)
main()
