require('log-timestamp');

const chalk = require('chalk');
const http = require('http')
const https = require('https')
const sqlite3 = require('sqlite3').verbose()
const url = require('url');
const process = require('process')
const os = require('os')

const db = new sqlite3.Database('./data/memory.db')

let cronHandle = -1
const C = 451.14021301

const hostuser = process.env.HOSTUSER
const hostpass = process.env.HOSTPASS
const hostname = process.env.HOSTNAME
const hostport = process.env.HOSTPORT || 443
const hostpath = process.env.HOSTPATH || '/'

const localport = process.env.LOCALPORT || 9922

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



const validateUrl = (value) => {
    return /^(?:(?:(?:https?|ftp):)?\/\/)(?:\S+(?::\S*)?@)?(?:(?!(?:10|127)(?:\.\d{1,3}){3})(?!(?:169\.254|192\.168)(?:\.\d{1,3}){2})(?!172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2})(?:[1-9]\d?|1\d\d|2[01]\d|22[0-3])(?:\.(?:1?\d{1,2}|2[0-4]\d|25[0-5])){2}(?:\.(?:[1-9]\d?|1\d\d|2[0-4]\d|25[0-4]))|(?:(?:[a-z\u00a1-\uffff0-9]-*)*[a-z\u00a1-\uffff0-9]+)(?:\.(?:[a-z\u00a1-\uffff0-9]-*)*[a-z\u00a1-\uffff0-9]+)*(?:\.(?:[a-z\u00a1-\uffff]{2,})))(?::\d{2,5})?(?:[/?#]\S*)?$/i.test(value);
}

const sqlGet = async(query, params) => new Promise((resolve, reject) => {
    const stmt = db.prepare(query)
    stmt.get(params, (err, row) => {
        stmt.finalize();
        if (err) { return reject(err) }
        return resolve(row)
    })
})

const sqlPut = async(query, params) => new Promise((resolve, reject) => {
    const stmt = db.prepare(query)
    stmt.run(params, (err) => {
        stmt.finalize();
        if (err) { return reject(err) }
        return resolve()
    })
})
const dupUrl = async (url) => ((await sqlGet('SELECT COUNT(*) as n FROM urls WHERE url=?', url))['n']) > 0 ? true : false
const countUrls = async () => (await sqlGet('SELECT COUNT(*) as n FROM urls WHERE forwarded_date is null', url))['n']

const storeURL = async (url) => {
    if (!validateUrl(url)) {
        console.error(chalk.red(`Invalid url: ${url}`))
        return { err: 'INV_URL' }
    }
    if (await dupUrl(url)) {
        console.error(chalk.red(`Duplicate url: ${url}`))
        return { err: 'DUP_URL' }
    }

    await sqlPut('INSERT INTO urls (url) VALUES (?)', url)
    console.info(chalk.green(`Adding url: ${url}`))

    return {id: 0}
}

const requestHandler = async (req, res) => {
    switch (req.url.substr(0,4)) {
        case '/REG':
            const queryObject = url.parse(req.url, true).query;
            const storeRes = await storeURL(queryObject.url)
            if (storeRes.err === undefined) {
                return res.end(`OK: ${storeRes.id}`)
            } else {
                return res.end(`FAIL: ${storeRes.err}`)
            }

        default:
            return res.end('UNKN: ' + Math.floor(Math.random()*10000000).toString(16))
    }
}

// DO REQUEST TO THE REAL TARGET
const repost = (urlData, msm, c, r, wp, w) => {
    console.info(chalk.blueBright(`Repost: `, urlData.url))

    // Use user+pass if provided
    if (hostuser !== undefined && hostpass !== undefined) {
        httpsOptions.headers = {
            'Authorization': 'Basic ' + Buffer.from(hostuser + ':' + hostpass).toString('base64')
         }
    }

    httpsOptions.path = httpsOptions.basePath + urlData.url
    const req = https.request(httpsOptions, res => {
        res.setEncoding('utf8')
        if (res.statusCode !== 200 && res.statusMessage !==302) {
            if (res.statusMessage.toString() === 'Found') {
                sqlPut(`UPDATE urls SET forwarded_date=datetime('now') WHERE id=?`, urlData.id)
                return true
            } else if (res.statusMessage.toString() === 'Gateway Time-out') {
                sqlPut(`UPDATE urls SET forwarded_date=datetime('now') WHERE id=?`, urlData.id)
                return console.warn(chalk.yellow(`WARN: ${res.statusCode} '${res.statusMessage}' (id:${urlData.id} marked as completed anyway).`))
            } else {
                return console.error(`Error: ${res.statusCode} '${res.statusMessage.toString()}'`)
            }
        }
        res.on('data', data => {
            if (data.substr(0,5) === 'Found') {
                sqlPut(`UPDATE urls SET forwarded_date=datetime('now') WHERE id=?`, urlData.id)
            } else {
                return console.error(chalk.red(`ERROR: ${data}`))
            }
        })
    })

    req.on('error', error => {
        if (error.toString() === 'Gateway Time-out' || error.toString() === 'Found') {
            console.warn(chalk.yellow(`WARN: ${error} (${urlData.id} marked as completed anyway)`))
            sqlPut(`UPDATE urls SET forwarded_date=datetime('now') WHERE id=?`, urlData.id)
        } else {
            console.error(`Error: '${error.toString()}`)
        }
    })

    req.end()


}

const cronHandler = async () => {
    if (cronHandle._idleNext !== null) { clearTimeout(cronHandle) }

    // Curve: https://www.wolframalpha.com/input/?i=tanh%28x*2.5+%2F+200%29+*+50+for+0+to+300
    const prob = toBell(msm() / 1440) / (C); // Bellcurve spreading prob over 1440 minutes so the sum of all probs is 1 thanks to C
    const newUrlCount = await countUrls()
    const M = 300       // Max - where should the curve plane out
    const DAM = 50      // Daily at Max - how many posts per day at M
    const weight = (Math.tanh(newUrlCount * 2.5 / M) * DAM) // tanh curve above
    const wprob = prob * weight
    const r = Math.random()

    // console.log(`cronHandler> msm: ${msm()} r: ${r} newUrlCount: ${newUrlCount} wprob: ${wprob} RUN?=${r < wprob}`)
    await sqlPut(`INSERT INTO cron_log (msm, url_count, random_value, weight, wprob) VALUES (?,?,?,?,?)`, [msm(), newUrlCount, r, weight, wprob])

    if (r < wprob) {
        const sqlRes = await sqlGet('SELECT id, url from urls where forwarded_date is null order by added_date limit 10')
        if (sqlRes !== undefined) {
            setTimeout(repost, Math.random()*60000, sqlRes, msm(), newUrlCount, r, wprob, weight)
        }
    }

    const sleepTime = (60000 + (Math.random()-0.5) * (30000))
    cronHandle = setTimeout(cronHandler, sleepTime)
}

const server = http.createServer(requestHandler)




// This returns values along a bell curve from 0 - 1 - 0 with an input of 0 - 1.
function toBell(x,scale){
    scale = scale || false;
    var stdD = .125
    var mean = .5
    if(scale){
        return  1 / (( 1/( stdD * Math.sqrt(2 * Math.PI) ) ) * Math.pow(Math.E , -1 * Math.pow(x - mean, 2) / (2 * Math.pow(stdD,2))));
    }else{
        return (( 1/( stdD * Math.sqrt(2 * Math.PI) ) ) * Math.pow(Math.E , -1 * Math.pow(x - mean, 2) / (2 * Math.pow(stdD,2)))) * toBell(.5,true);
    }
}

// Minutes since midnight
const msm = () => {
    const now = new Date()
    const then = new Date(
            now.getFullYear(),
            now.getMonth(),
            now.getDate(),
            0,0,0)
    return Math.floor((now.getTime() - then.getTime()) / 60000); // difference in minutes
}







async function main() {
    console.info(chalk.green('Start'))

    await db.exec(`CREATE TABLE IF NOT EXISTS urls (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            url TEXT not null,
            added_date timestamp default current_timestamp,
            forwarded_date timestamp default null
        )`)

    await db.exec(`create table if not exists cron_log (
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
    cronHandle = setTimeout(cronHandler, 10)
}




main()

