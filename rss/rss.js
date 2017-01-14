/*
    This is used after initialization for all feeds on first startup.
    The main RSS file that is looping.

    The steps are nearly the same except that this is on a loop, and
    there is no filtering because all unseen data by checkTable is,
    by default, new data because it is on a loop.

    It still has to check the table however because the feedparser
    grabs ALL the data each time, new and old, through the link.
*/

const FeedParser = require('feedparser');
const requestStream = require('./request.js')
const translator = require('./translator/translate.js')
const sqlConnect = require('./sql/connect.js')
const sqlCmds = require('./sql/commands.js')


function isEmptyObject(obj) {
  for (var key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      return false;
    }
  }
  return true;
}

module.exports = function (con, rssList, rssIndex, channel, sendingTestMessage, callback) {
  var rssConfig = require('../config.json')

  var feedparser = new FeedParser()
  var currentFeed = []

  requestStream(rssList[rssIndex].source.link, feedparser, con, function() {
    callback()
    feedparser.removeAllListeners('end')
  })

  feedparser.on('error', function (error) {
    console.log(error)
  });

  feedparser.on('readable',function () {
    var stream = this;
    var item;

    while (item = stream.read()) {
      currentFeed.push(item);
    }
});

  feedparser.on('end', function() {
    let feedName = rssList[rssIndex].source.name
    var processedItems = 0;
    var filteredItems = 0;
    //console.log("RSS Info: Starting retrieval for: " + feedName);

    function startDataProcessing() {
      const fs = require('fs')
      const fileOps = require('../util/updateJSON.js')
      if (rssList[rssIndex].guild !== `(${channel.guild.id + ".json"}, ${channel.guild.name})`) {
        if (fs.existsSync(`./sources/${channel.guild.id}.json`)) {
          var guildRss = require(`../sources/${channel.guild.id}.json`);
          guildRss.name = channel.guild.name
          fileOps.updateFile(`./sources/${channel.guild.id}.json`, guildRss)
        }
      }

      createTable();
    }

    function createTable() {
      sqlCmds.createTable(con, feedName, function (err, rows) {
        if (err) throw err;
        if (currentFeed.length == 0) {
          console.log(`RSS Info: ${rssList[rssIndex].guild} => "${rssList[rssIndex].source.name}" has no feeds to send for testrss.`);
          callback();
          return channel.sendMessage(`Feed "${rssList[rssIndex].source.link}" has no available RSS that can be sent.`);
        }
        if (sendingTestMessage) {
          let randFeedIndex = Math.floor(Math.random() * (currentFeed.length - 1))
          checkTable(currentFeed[randFeedIndex].guid, currentFeed[randFeedIndex]);
        }
        else {
          let feedLength = currentFeed.length - 1
          for (var x = feedLength; x >= 0; x--){ //get feeds starting from oldest, ending with newest.
            checkTable(currentFeed[x].guid, currentFeed[x]); // .guid is the feed item for the table entry, the second param is the info needed to send the actual message
            filteredItems++;
          }
        }
      })
    }

    function checkTable(data, feed) {
      if (sendingTestMessage) {
        filteredItems++;
        gatherResults();
        var message = translator(channel, rssList, rssIndex, feed, true);
        console.log(`RSS Info: ${rssList[rssIndex].guild} => Sending test message for: ${rssList[rssIndex].source.name}`)
        if (message.embedMsg != null)
          channel.sendMessage(message.textMsg,message.embedMsg).then(m => m.channel.stopTyping());
        else
          channel.sendMessage(message.textMsg).then(m => m.channel.stopTyping());
      }
      else {
        sqlCmds.select(con, feedName, data, function (err, results, fields) {
          if (err) throw err;

          if (!isEmptyObject(results)) {
            //console.log(`already seen ${feed.link}, not logging`);
            gatherResults();
          }

          else {
            console.log(`RSS Info: ${rssList[rssIndex].guild} => Never seen ${feed.link}, sending message for RSS named "${rssList[rssIndex].source.name}".`);
            //console.log(`never seen ${feed.link}, logging now`);
            var message = translator(channel, rssIndex, feed, false);
            if (message.embedMsg != null)
              channel.sendMessage(message.textMsg,message.embedMsg);
            else
              channel.sendMessage(message.textMsg);

            insertIntoTable(data);
          }

        })
      }
    }


    function insertIntoTable(data) { //inserting the feed into the table marks it as "seen"
      sqlCmds.insert(con, feedName, data, function (err,res) {
        if (err) throw err;
        gatherResults();
      })
    }

    function gatherResults(){
      processedItems++;
      //console.log(filteredItems + " " + processedItems) //for debugging
      if (processedItems == filteredItems) {
        callback();
        console.log(`RSS Info: ${rssList[rssIndex].guild} => Finished retrieval for: ${feedName}`)
      }
    }

    startDataProcessing();
  });
}
