const C = 451.14021301

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
const cronHandler = async (newUrlCount) => {
// if (cronHandle._idleNext !== null) { clearTimeout(cronHandle) }

// Curve: https://www.wolframalpha.com/input/?i=tanh%28x*2.5+%2F+200%29+*+50+for+0+to+300
const prob = toBell(msm() / 1440) / (C) // Bellcurve spreading prob over 1440 minutes so the sum of all probs is 1 thanks to magic constant C = 451.14021301
// const newUrlCount = 500; // await countUrls()
const M = 1500 // Max - where should the curve plane out
const DAM = 30 // Daily at Max - how many posts per day at M
const weight = (Math.tanh(newUrlCount / M) * DAM) // tanh curve above
const wprob = prob * weight
const r = Math.random()

// console.log(`cronHandler> msm: ${msm()} r: ${r} newUrlCount: ${newUrlCount} wprob: ${wprob} RUN?=${r < wprob}`)
// await sqlPut('INSERT INTO cron_log (msm, url_count, random_value, weight, wprob) VALUES (?,?,?,?,?)', [msm(), newUrlCount, r, weight, wprob])

// if (r < wprob || !LAST_SUCCESS) {
//   LAST_SUCCESS = false
//   await repost(0)
// }

const sleepTime = (60000 + (Math.random() - 0.5) * (30000))
// if (DBG) {
//   console.log(chalk.green(`Sleeping for ${Math.round(sleepTime / 1000)}s`))
// }
//sleep(cronHandler, sleepTime)
return {sleepTime, posted: r < wprob, wprob }
}

const runCron = async (newUrlCount) => {
    let now = 0; // time of day in milliseconds
    let postCount = 0; // number of images posted
    let cronCount = 0; // number of times cron ran.
    while (now < 86400*1000) {
        const {sleepTime, posted, wprob} = await cronHandler(newUrlCount); // returns ms
        // console.log(`${now},\t${posted},\t${wprob},\t${sleepTime}`)
        if (posted) { postCount += 1; }
        now += sleepTime;
        cronCount += 1;
    }

    return {newUrlCount, postCount, cronCount}
}

const main = async() => {
for(let newUrlCount=10; newUrlCount<=200; newUrlCount+=20) {
    const {postCount, cronCount} = await runCron(newUrlCount);
    console.log({newUrlCount, postCount, cronCount})
}

}

main()