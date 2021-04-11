/*native node modules*/
const https = require("https");
const fs = require("fs");
const EventEmitter = require("events");

/*express modules*/
const express = require("express");
const parser = require("body-parser");

/*cheerio modules*/
const cheerio = require("cheerio"); //needs lot of memory 3mb to 3.5mb

/*Custom modules*/
const session = require ('./session.js');
const logger = require('./logger');


/*Environment Variables*/
const PAGE_REQUEST_INTERVAL = process.env.PAGE_REQUEST_INTERVAL || 3000;
const PORT = process.env.PORT || 3000;
const PATH = __dirname;
const SITES_JSON_PATH = PATH + "/sites.json";
const PUBLIC_PATH = PATH + "/public";
const DOWNLOADS_PATH = PATH + "/downloads"; /*ONLY FOR WRITING ON SERVER DISK */
const DEBUG_PATH = PATH + "/debug";

/*DEFAULT SETTINGS*/
const NUM_CHAPTERS = 25;
const PING_INTERVAL = 1 * 60 * 1000; //in milliseconds 2x of client side ping rate

/*JSON Data for default site values*/
const sites = [
  {
    id: 0,
    baseURL: "https://novelbuddy.com",
    nextBtn: "#btn-next",
    readChapterBtn: "#readchapterbtn",
  },
];

/*Constants*/
const siteMap = new Map();
const job = new EventEmitter();

const app = express();

/*Content-Type from client is application/x-www-form-urlencoded*/
app.use(parser.urlencoded({ extended: true }));

/*resource files*/
app.use(express.static(PUBLIC_PATH));

/*GET request on page load, root page*/
app.get("/", function (reqClient, resClient) {
  resClient.sendFile(PATH + "/index.html");
});

/*GET request on clicking twitter link*/
app.get("/twitter", function (req, res) {
  res.redirect("https://twitter.com/VsSudarshan");
});

function generateToken(){
  let token = session.generateToken();
    logger.log("\nSession token: " + token);
    return token;
}

/*POST request on page load, generate unique session token*/
app.post("/start", (req, res) => {
  res.send(generateToken());
});

/*POST request on page unload*/
app.post("/stop", (req, res) => {
  if (
    req.body.token &&
    session.isSession(req.body.token) &&
    session.getSession(req.body.token).nextLink
  ) {
    logger.log("\n\n Stop request (@" + reqNovel.body.token + ")");
      endProcess(req.body.token);
  }
  res.send();
});

/*POST request to keep session alive*/
app.post("/ping", (req, res) => {
  logger.log("\nPING " + req.body.token);
  if (req.body.token && session.isSession(req.body.token)) {
    session.getSession(req.body.token).lastActive = Date.now();
    res.send("200");
  } else {
  res.send("406");
  }
});

/*on form submit, post request*/
app.post("/novel", function (reqNovel, resNovel) {

  if (!reqNovel.body.token || session.isSession(reqNovel.body.token)) {
    logger.log("Invalid session. Access Denied. (@" + reqNovel.body.token + ")");
    endProcess(reqNovel.body.token);
    resNovel.send("Invalid session. Access Denied.");
    return;
  }

  var sessionData = {
    token: reqNovel.body.token,
    lastActive: Date.now(),
    hasEnded: false,
    fileName: "",
    writeStream:resNovel || null, /* SET TO NULL for server disk writing version */
    currentLink: reqNovel.body.nLink || "",
    nextLink: "",
    title: "",
    author: [],
    summary: "",
    chapter: { num: 0, name: "", content: "" },
    numOfChapters: reqNovel.body.nChapter || NUM_CHAPTERS,
    errorTick: 0,
  };

  let siteData = getSiteData(sessionData.currentLink);

  if (siteData) {
    logger.log(
      "\n\n\nRequested URL: (@ " +
        sessionData.token +
        "): " +
        sessionData.currentLink
    );
    logger.log(
      "\nNumber of Chapters: (@ " +
        sessionData.token +
        "): " +
        sessionData.numOfChapters
    );
    session.addSession(sessionData);
    requestPage(sessionData, siteData, 0);
  } else {
    logger.log("\n\n\nERROR: Invalid URL (@ " + sessionData.token + ")");
    resNovel.end("Invalid URL");
  }

  sessionData.writeStream.once("error", (err) => {
    logger.log(
      "\n\n\nStream Write Error (@ " + sessionData.token + "): " + err.message
    );
    sessionData.errorTick = 11;
  });
});

function endProcess(token) {
  //final clean up and session end
  if (!token) return;

  let sessionData = session.getSession(token);
  sessionData.hasEnded = true;

  let wait = 3000;

  logger.log(
    "Wait " +
      wait / 1000 +
      " seconds for write processes to end. (" +
      sessionData.token +
      ")"
  );

  setTimeout(() => {
    logger.log("\n\n\nSession Ended: (" + sessionData.token + ")");
    sessionData.writeStream.removeAllListeners("error");
    sessionData.writeStream.end();
    sessionData.writeStream.send(); /*THIS LINE IS ONLY FOR WRITE ON CLIENT DISK */
    sessionData = null;
    session.endSession(token);
  }, wait);
}

/*returns siteData from siteMap`*/
function getSiteData(link) {
  return siteMap.get(link.split("/")[2]);
}

/*website crawler logic*/
function requestPage(sessionData, siteData, chapterCount) {
  if (
    sessionData.hasEnded ||
    Date.now() - sessionData.lastActive >= PING_INTERVAL
  ) {
    // inactive threshold
    endProcess(sessionData.token);
    return;
  }
  if (sessionData.errorTick > 10) {
    logger.log(
      "\n\n\nCannot resolve errors. Process stopped. (@ " +
        sessionData.token +
        ")"
    );
    endProcess(sessionData.token);
    return;
  }

  var htmlData = [];
  var $;
  var found = false;

  logger.log(
    "\n\n\nCurrent Link (@ " +
      sessionData.token +
      "): " +
      sessionData.currentLink
  );

  https
    .get(sessionData.currentLink, (res) => {
      if (res.statusCode !== 200) {
        logger.log(
          "\n\n\nResponse code from URL (@ " +
            sessionData.token +
            "): " +
            res.statusCode
        );
        logger.log("\nMessage (@ " + sessionData.token + "): " + res.statusMessage);
        logger.log("\nProcess stopped.");
        res.resume();
        endProcess(sessionData.token);
        return;
      }

      res
        .on("data", (data) => {
          htmlData.push(data); //this is better for cheerio instead of concatenation
        })
        .once("error", (e) => {
          logger.log(
            "\n\n\nHTTPS Response Stream Error (@ " +
              sessionData.token +
              "): " +
              e.message
          );
          logger.log("\nProcess stopped. (@ " + sessionData.token + ")");
          endProcess(sessionData.token);
        });

      res.once("end", () => {
        if (!res.complete)
          logger.log(
            "\n\n\nPartial data from URL (@ " +
              sessionData.token +
              "): " +
              sessionData.currentLink +
              "\nTrying to continue."
          );

        $ = cheerio.load(htmlData.join(""));

        found = isChapterAndUpdateNext($, sessionData, siteData);
        logger.log(
          "Next link from chapter (@ " +
            sessionData.token +
            "): " +
            sessionData.nextLink
        );

        if (found && !sessionData.hasEnded) {
          found = getChapterAndWriteToFile($, sessionData, siteData);
        } else {
          found = novelInfoAndUpdateNext($, sessionData, siteData);
          logger.log(
            "Next link from main page (@ " +
              sessionData.token +
              "): " +
              sessionData.nextLink
          );
        }

        if (
          sessionData.numOfChapters &&
          ++chapterCount > sessionData.numOfChapters
        ) {
          logger.log("\nProcess complete. (@ " + sessionData.token + ")");
          endProcess(sessionData.token);
          return;
        }

        if (!found || sessionData.errorTick > 10 || sessionData.hasEnded) {
          logger.log("Aborted. (@ " + sessionData.token + ")");
          endProcess(sessionData.token);
          return;
        }

        if (sessionData.nextLink) {
          sessionData.currentLink = siteData.baseURL + sessionData.nextLink;
          logger.log(
            "Next page (@ " +
              sessionData.token +
              "): " +
              sessionData.currentLink
          );

          setTimeout(function () {
            requestPage(sessionData, siteData, chapterCount);
          }, PAGE_REQUEST_INTERVAL);
        } else {
          logger.log("\nNo more links. (@ " + sessionData.token + ")");
          endProcess(sessionData.token);
        }
      });
    })
    .once("error", (e) => {
      logger.log(
        "\n\n\nHTTPS Get Error (@ " + sessionData.token + "): " + e.message
      );

      if (++sessionData.errorTick > 10) {
        /*termination after 10 error ticks*/
        logger.log("\n\n\nCannot resolve errors. Process stopped.");
        endProcess(sessionData.token);
      } else {
        logger.log(
          "\nWill try again in: " +
            (PAGE_REQUEST_INTERVAL * 2) / 1000 +
            " seconds."
        );
        setTimeout(function () {
          requestPage(sessionData, siteData, chapterCount);
        }, PAGE_REQUEST_INTERVAL * 2);
      }
    });
}

/*check if currentLink is chapter and update the nextLink if possible*/
function isChapterAndUpdateNext($, sessionData, siteData) {
  var elements = $(siteData.nextBtn);

  logger.log(
    "Nav buttons in chapter (@ " + sessionData.token + "): " + elements.length
  );

  if (elements.length !== 0) {
    sessionData.nextLink = elements.attr("href");
    return true;
  }

  return false;
}

/*check if currentLink is main page and update novel info if possible*/
function novelInfoAndUpdateNext($, sessionData, siteData) {
  var elements = $(siteData.readChapterBtn);

  logger.log(
    "Nav buttons in main (@ " + sessionData.token + "): " + elements.length
  );

  if (elements.length !== 0) {
    getMainPage($, sessionData, siteData);
    sessionData.nextLink = elements.attr("href");

    return true;
  }

  return false;
}

/*select functions based on website*/
function getChapterAndWriteToFile($, sessionData, siteData) {
  if (sessionData.writeStream.socket._writableState.ended) {
    sessionData.hasEndednd = true;
    return false;
}
  var content = null;
  switch (siteData.id) {
    case 0:
      content = novelBuddyChapter($, sessionData);
      break;
  }

  if (content) {
    sessionData.errorTick = 0;
    return writeToFile(sessionData);
  }

  sessionData.errorTick++;
  return false;
}

function getMainPage($, sessionData, siteData) {
  switch (siteData.id) {
    case 0:
      novelBuddyMainPage($, sessionData);
      sessionData.errorTick = 0;
      break;

    default:
      sessionData.errorTick++;
  }
}

/*Custom Code for each website */

function novelBuddyChapter($, sessionData) {
  var chDetails = sessionData.currentLink.split("/")[4].split("-");

  sessionData.chapter.num = chDetails[1];

  sessionData.chapter.name = chDetails
    .splice(2, chDetails.length - 2)
    .join(" ");

  //check if class name matches website
  sessionData.chapter.content = $(".content-inner")
    .children("p")
    .map(function () {
      return $(this).text();
    })
    .get()
    .join("\n\n");

  return sessionData.chapter.content;
}

function novelBuddyMainPage($, sessionData) {
  //check if class name matches website
  $(".author")
    .children("a")
    .each(function () {
      sessionData.author.push($(this).attr("title"));
    });

  sessionData.summary = $(".summary").children(".content").text().trim();
}

/*      End custom code                       */

/*write data to file using a write stream */
function writeToFile(sessionData) {
  if (!sessionData.chapter.content) return;

  var novel = "";

  if (!sessionData.fileName) {
    sessionData.title = sessionData.currentLink
      .split("/")[3]
      .split("-")
      .join(" ");

    novel = "Title: " + sessionData.title + "\nAuthor(s):";

    for (let i = 0; i < sessionData.author.length; i++)
      novel += "\n" + sessionData.author[i];

    novel += "\n\nSummary\n" + sessionData.summary;

    sessionData.fileName =
      sessionData.title +
      "_" +
      sessionData.chapter.num +
      "@" +
      sessionData.token +
      ".txt";
  }

  novel +=
    "\n\nChapter " +
    sessionData.chapter.num +
    " " +
    sessionData.chapter.name +
    "\n\n" +
    sessionData.chapter.content;

  /*CLIENT DISK VERSION */
  return writeToClient(sessionData, novel);

  /* SERVER DISK VERSION*/
  //writeToServer(sessionData, novel);
}

/*CODE FOR WRITING TO CLIENT DISK*/
async function writeToClient(sessionData, novel) {
  try {
    if (!sessionData.writeStream.headersSent) {
      sessionData.writeStream.writeHead(200, {
        "Content-Type": "text/plain",
        "Content-Disposition": "attachment; filename=" + sessionData.fileName,
      });
    }
  } catch (err) {
    logger.log(
      "\n\n\nStream Header write Error (@ " +
        sessionData.token +
        "): " +
        err.message
    );
    return false;
  }

  var canWrite = sessionData.writeStream.write(novel, () => {
    sessionData.chapter.content = null;
    logger.log(
      "Session " +
        sessionData.token +
        ": " +
        "Novel " +
        sessionData.title +
        " Chapter " +
        sessionData.chapter.num +
        " written!"
    );
  });

  if (!canWrite) await drain(sessionData);
  else sessionData.writeStream.removeAllListeners("drain");
}

async function drain(sessionData) {
  return new Promise((resolve, reject) => {
    sessionData.writeStream.once("drain", resolve);
  });
}

/*CODE FOR WRITING TO SERVER DISK*/
// async function writeToServer(sessionData, novel){
// var canWrite = true;
//
//   if(!sessionData.writeStream){
//
//      logger.log("\n\n\nCreate stream : " + sessionData.fileName);
//      sessionData.writeStream = fs.createWriteStream(DOWNLOADS_PATH + '/' + sessionData.fileName, {flags: 'a+'});
//
//      sessionData.writeStream.once('ready', ()=>{
//        logger.log("\nReady to write: " + sessionData.fileName);
//        canWrite = writeServerFile(sessionData, novel);
//      });
//
//     sessionData.writeStream.once('error', (err)=>{
//        logger.log("\n\n\nStream Write Error (@ " + sessionData.token + "): " + err.message);
//        sessionData.errorTick = 11;
//      });
//    }
//    else {
//      canWrite = writeServerFile(sessionData, novel);
// }
//
//    // if(!canWrite)
//    // await drain();
//       else
//        sessionData.writeStream.removeAllListeners('drain');
// }
//
// function writeServerFile(sessionData, novel){
//
//   return sessionData.writeStream.write(novel, () =>{
//       sessionData.chapter.content = null;
//       logger.log("Session " + sessionData.token + ": " + "Novel " +
//       sessionData.title + " Chapter " + sessionData.chapter.num + ' written!');
//    });
// }

/*Run at server start*/
app.listen(PORT, function () {
  logger.log("\n\n\nServer started");
  logger.log("\n\n\nListening on port: " + PORT);
  loadSiteMap();

  /*CODE FOR WRITE ON SERVER DISK */
  //  fs.access(DOWNLOADS_PATH, fs.constants.F_OK, (err) => {
  //
  //    if(err && err.code === 'ENOENT'){  //no folder, then create
  //     logger.log("\n\n\nFolder Access Error: " + err.message);
  //     logger.log("\nCreating directory...");
  //      fs.mkdirSync(DOWNLOADS_PATH);
  //    }else if(err){
  //      logger.log("\n\n\nSomething went wrong!\nFolder Access Error: " + err.message); //other errors
  //      process.exit(1);
  //    }  else {
  //      logger.log("\n\n\n" + DOWNLOADS_PATH +  " already exists!");  //folder exists
  //    }
  //
  // });
});

/*load sites from JSON file */
function loadSiteMap() {
  logger.log("\n\n\nLoading Site Maps.");

  try {
    JSON.parse(fs.readFileSync(SITES_JSON_PATH)).forEach((site) => {
      loadSite(site);
    });
  } catch (err) {
    logger.log("\n\n\nJSON File Read Error: " + err);
    logger.log("\nUsing default sites.\n");
    loadDefaultSiteMap();
  }
}

function loadDefaultSiteMap() {
  sites.forEach((site) => {
    loadSite(site);
  });
}

function loadSite(site) {
  siteMap.set(site.baseURL.split("/")[2], site);
  logger.log("Loading site: " + site.baseURL);
}


/*write memory usage every 10 minutes */

setInterval(function () {
  if (typeof gc === "function") {
    gc();
  }
  logger.log(process.memoryUsage());
}, 600000);
