/*
    This is only used when adding new feeds through Discord channels.

    The process is:
    1. Retrieve the feed through request
    2. Feedparser sends the feed into an array
    3. Connect to SQL database
    4. Create table for feed for that Discord channel
    7. Log all current feed items in table
    8. gatherResults() and close connection
    9. Add to config
*/
const requestStream = require('./request.js')
const FeedParser = require('feedparser');
const fileOps = require('../util/updateJSON.js')
const sqlConnect = require('./sql/connect.js')
const sqlCmds = require('./sql/commands.js')
const startFeedSchedule = require('../util/startFeedSchedule.js')

function isEmptyObject(obj) {
  for (var key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      return false;
    }
  }
  return true;
}

module.exports = function (con, verifyMsg, rssLink, channel, callback) {

  var feedparser = new FeedParser()
  var currentFeed = []

  requestStream(rssLink, feedparser, function(err) {
    if (err) {
      console.log(`RSS Warning: Unable to add ${rssLink}, could not connect due to invalid response. (${err})`);
      return callback(`Unable to add <${rssLink}>, could not connect due to invalid response. Be sure to validate your feed.`);
    }
  })

  feedparser.on('error', function (err) {
    if (err)  {
      feedparser.removeAllListeners('end');
      console.log(`RSS Warning:: Unable to add ${rssLink} due to invalid feed.`);
      return callback(`Unable to add <${rssLink}>, could not validate as a proper feed.`);
    }
  });

  feedparser.on('readable',function () {
    var stream = this;
    var item;

    while (item = stream.read()) {
      currentFeed.push(item);
    }
});

  feedparser.on('end', function() {
    var metaLink = ""
    var randomNum = Math.floor((Math.random() * 99) + 1)
    if (currentFeed[0] != null) metaLink = (currentFeed[0].meta.link != null) ? currentFeed[0].meta.link : currentFeed[0].meta.title;

    var feedName = `${channel.id}_${randomNum}${metaLink}`

    if (metaLink == "" ) {
      channel.sendMessage("Cannot find meta link for this feed. Unable to add to database. This is most likely due to no existing articles in the feed.");
      console.log(`RSS Info: (${channel.guild.id}, ${channel.guild.name}) => Cannot initialize feed because of no meta link: ${rssLink}`)
      return callback();
    }

    //MySQL table names have a limit of 64 char
    if (feedName.length >= 64 ) feedName = feedName.substr(0,64);
    feedName = feedName.replace(/\?/g, "")


    var processedItems = 0
    var totalItems = currentFeed.length

    console.log(`RSS Info: (${channel.guild.id}, ${channel.guild.name}) => Initializing new feed: ${rssLink}`)

    function startDataProcessing() {
      createTable()
    }

    function createTable() {
      sqlCmds.createTable(con, feedName, function (err, rows) {
        if (err) throw err;
        for (var x in currentFeed){
          if (currentFeed[0].guid == null && currentFeed[0].pubdate !== "Invalid Date") var feedId = currentFeed[x].pubdate;
          else if (currentFeed[0].guid == null && currentFeed[0] === "Invalid Date" && currentFeed[0].title != null) var feedId = currentFeed[x].title;
          else var feedId = currentFeed[x].guid;
          checkTable(feedId);
        }
      })
    }

    function checkTable(data) {
      sqlCmds.select(con, feedName, data, function (err, results, fields) {
        if (err) throw err;
        insertIntoTable(data);
      })
    }

    function insertIntoTable(data) {
      sqlCmds.insert(con, feedName, data, function (err, res){
        if (err) throw err;
        gatherResults();
      })

    }

    function gatherResults(){
      processedItems++;
      if (processedItems == totalItems) {
        addToConfig();
      }
    }

    function addToConfig() {
      if (currentFeed[0].meta.title == null || currentFeed[0].meta.title == "") var metaTitle = "No feed title found.";
      else var metaTitle = currentFeed[0].meta.title;

      if (currentFeed[0].guid != null && currentFeed[0].guid.startsWith("yt:video")) metaTitle = `Youtube - ${currentFeed[0].meta.title}`;
      else if (currentFeed[0].meta.link != null && currentFeed[0].meta.link.includes("reddit")) metaTitle = `Reddit - ${currentFeed[0].meta.title}`;

      if (fileOps.exists(`./sources/${channel.guild.id}.json`)) {
        var guildRSS = require(`../sources/${channel.guild.id}.json`);
        var rssList = guildRSS.sources;
        rssList.push({
      		enabled: 1,
      		name: feedName,
          title: metaTitle,
      		link: rssLink,
      		channel: channel.id
      	});
      }
      else {
        var guildRSS = {
          name: channel.guild.name,
          id: channel.guild.id,
          sources: [{
        		enabled: 1,
        		name: feedName,
            title: metaTitle,
        		link: rssLink,
        		channel: channel.id
        	}]
        };
      }

      fileOps.updateFile(channel.guild.id, guildRSS, `../sources/${channel.guild.id}.json`)
      callback();

    }

    return startDataProcessing()
  });

}
