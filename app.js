/*native node modules*/
const https = require('https');
const fs = require('fs');
const EventEmitter = require('events');
const util = require('util');

/*express modules*/
const express = require('express');
const parser = require('body-parser');

/*cheerio modules*/
const cheerio = require('cheerio');  //needs lot of memory 3mb to 3.5mb

/*Environment Variables*/
const PAGE_REQUEST_INTERVAL = process.env.PAGE_REQUEST_INTERVAL || 3000;
const PORT = process.env.PORT || 3000;
const PATH = __dirname;
const SITES_JSON_PATH = PATH + '/sites.json';
const PUBLIC_PATH = PATH + '/public';
const DOWNLOADS_PATH = PATH + '/downloads'; /*ONLY FOR WRITING ON SERVER DISK */
const DEBUG_PATH = PATH + '/debug';

/*DEFAULT SETTINGS*/
const NUM_CHAPTERS = 25;
const PING_INTERVAL = 1 * 60 * 1000; //in milliseconds 2x of client side ping rate

/*JSON Data for default site values*/
const sites = [{id: 0, baseURL: 'https://novelbuddy.com', nextBtn:'#btn-next', readChapterBtn: '#readchapterbtn'}];

/*Constants*/
const siteMap = new Map();
const job = new EventEmitter();
const app = express();

/*Session tracker*/
const activeSession = new Map();

/*session token generator*/
function generateToken(){

  let token = '';
  let count = 0;
  let val = 0;
  let n = 0;
  do{
    val = Math.floor(Math.random() * 26);
    n = Math.floor(Math.random() * 2);

    switch(n){
      case 0:
      n = 65;
      break
      case 1:
      n = 97;
    }

    val += n;
    token += String.fromCharCode(val);
  }while(count++ < 5);

  logger("\nSession token: " + token);
  return token;
}

function isSession(token){
return activeSession.has(token)
}

function addSession(sessionData){
activeSession.set(sessionData.token, sessionData);
}

function getSession(token){
return activeSession.get(token)
}

/*remove session from activeSession and stop process*/
function endSession(token){
  if(!token)
  return;
endProcess(getSession(token));
return activeSession.delete(token);
}

/*Session Tracker */

/*Content-Type from client is application/x-www-form-urlencoded*/
app.use(parser.urlencoded({ extended: true }));


/*resource files*/
app.use(express.static(PUBLIC_PATH));



/*GET request on page load, root page*/
app.get('/', function(reqClient, resClient){
 resClient.sendFile(PATH + '/index.html');
});

/*GET request on clicking twitter link*/
app.get('/twitter', function(req,res){
res.redirect('https://twitter.com/VsSudarshan');
});

/*POST request on page load, generate unique session token*/
app.post('/start', (req, res) => {
     res.send(generateToken());
});

/*POST request on page unload*/
app.post('/stop', (req, res) => {
    if(req.body.token && isSession(req.body.token) && getSession(req.body.token).nextLink){
             logger("\n\n Stop request (@" + reqNovel.body.token + ")")
             endSession(req.body.token);
           }
res.send();
});

/*POST request to keep session alive*/
app.post('/ping', (req, res)=>{
  logger("\nPING " + req.body.token);
  if(req.body.token && isSession(req.body.token)){
  getSession(req.body.token).lastActive = Date.now();
  res.send('200');
}else {
    res.send('406');
  }
});

/*on form submit, post request*/
app.post('/novel', function(reqNovel, resNovel){
p = 1;
  if(!reqNovel.body.token || isSession(reqNovel.body.token)){
  logger("Access Denied. (@" + reqNovel.body.token + ")");
  endSession(reqNovel.body.token);
  resNovel.send("Access Denied.");
  return;
}

  var sessionData = {
    token: reqNovel.body.token,
    lastActive: Date.now(),
    hasEnded: false,
    fileName: '',
    writeStream: resNovel || null, /* SET TO NULL for server disk writing version */
    currentLink: reqNovel.body.nLink || '',
    nextLink: '',
    title: '',
    author: [],
    summary: '',
    chapter: {num: 0, name: '', content: ''},
    numOfChapters: reqNovel.body.nChapter || NUM_CHAPTERS,
    errorTick: 0,
  };


  let siteData = getSiteData(sessionData.currentLink);

  if(siteData){
    logger("\n\n\nRequested URL: (@ " + sessionData.token + "): " + sessionData.currentLink);
    logger("\nNumber of Chapters: (@ " + sessionData.token + "): " + sessionData.numOfChapters);
    addSession(sessionData);
    requestPage(sessionData, siteData, 0);
  }else {
    logger("\n\n\nERROR: Invalid URL (@ " + sessionData.token + ")");
    resNovel.end();
  }

  sessionData.writeStream.once('error', (err)=>{
    logger("\n\n\nStream Write Error (@ " + sessionData.token + "): " + err.message);
    sessionData.errorTick = 11;
  });
});


function endProcess(sessionData){
    //final clean up and session end
    let wait = 3000;
    sessionData.hasEnded = true;

    logger("Wait " + (wait/1000) + " seconds for write processes to end. (" + sessionData.token + ")")

    setTimeout(()=>{
    logger("\n\n\nSession Ended: (" + sessionData.token + ")");
    sessionData.writeStream.removeAllListeners('error');
    sessionData.writeStream.end();
    sessionData.writeStream.send(); /*THIS LINE IS ONLY FOR WRITE ON CLIENT DISK */
    sessionData = null;
  }, wait);
}


/*returns siteData from siteMap`*/
function getSiteData(link){
  return siteMap.get(link.split('/')[2]);
}





/*website crawler logic*/
function requestPage(sessionData, siteData, chapterCount){

  if(sessionData.hasEnded || (Date.now() - sessionData.lastActive) >= PING_INTERVAL){ //8 seconds inactive threshold
   logger("\nNO PING (@ " + sessionData.token + ")");
   endSession(sessionData.token);
   return;
}
  if(sessionData.errorTick > 10){
    logger("\n\n\nCannot resolve errors. Process stopped. (@ " + sessionData.token + ")");
    endSession(sessionData.token);
    return;
  }

  var htmlData = [];
  var $;
  var found = false;

  logger("\n\n\nCurrent Link (@ " + sessionData.token + "): " + sessionData.currentLink);

  https.get(sessionData.currentLink, (res) => {

    if(res.statusCode !== 200){
      logger("\n\n\nResponse code from URL (@ " + sessionData.token + "): " + res.statusCode);
      logger("\nMessage (@ " + sessionData.token + "): " + res.statusMessage);
      logger("\nProcess stopped.");
      res.resume();
      endSession(sessionData.token);
      return;
    }

    res.on('data', (data)=>{

      htmlData.push(data); //this is better for cheerio instead of concatenation

    }).once('error',(e)=>{
      logger("\n\n\nHTTPS Response Stream Error (@ " + sessionData.token + "): "+ e.message);
      logger("\nProcess stopped. (@ " + sessionData.token + ")");
      endSession(sessionData.token);
    });

    res.once('end', () => {

      if(!res.complete)
      logger("\n\n\nPartial data from URL (@ " + sessionData.token + "): " +
      sessionData.currentLink + "\nTrying to continue.");

     $ = cheerio.load(htmlData.join(''));

      found = isChapterAndUpdateNext($, sessionData, siteData);
      logger("Next link from chapter (@ " + sessionData.token + "): " + sessionData.nextLink);

      if(found && !sessionData.hasEnded){
       found = getChapterAndWriteToFile($, sessionData, siteData);
      }else {
        found = novelInfoAndUpdateNext($, sessionData, siteData);
        logger("Next link from main page (@ " + sessionData.token + "): " + sessionData.nextLink);
      }

      if(sessionData.numOfChapters && ++chapterCount > sessionData.numOfChapters){
        logger("\nProcess complete. (@ " + sessionData.token + ")");
        endSession(sessionData.token);
        return;
      }

      if(!found || sessionData.errorTick > 10){
      logger("Aborted. (@ " + sessionData.token + ")");
      endSession(sessionData.token);
      return;
      }

      if(sessionData.nextLink){

        sessionData.currentLink = siteData.baseURL + sessionData.nextLink;
        logger("Next page (@ " + sessionData.token + "): " + sessionData.currentLink);

        setTimeout(function () {
          requestPage(sessionData, siteData, chapterCount);
        }, PAGE_REQUEST_INTERVAL);

      }else{
        logger("\nNo more links. (@ " + sessionData.token + ")");
        endSession(sessionData.token);
      }
    });
}).once('error',(e)=>{
    logger("\n\n\nHTTPS Get Error (@ " + sessionData.token + "): "+ e.message);

    if(++sessionData.errorTick > 10){                    /*termination after 10 error ticks*/
      logger("\n\n\nCannot resolve errors. Process stopped.");
      endSession(sessionData.token);
    }else {
      logger("\nWill try again in: " + ((PAGE_REQUEST_INTERVAL * 2)/1000) + " seconds.");
      setTimeout(function () {
        requestPage(sessionData, siteData, chapterCount);
      }, PAGE_REQUEST_INTERVAL * 2);
    }
  });
}

/*check if currentLink is chapter and update the nextLink if possible*/
function isChapterAndUpdateNext($, sessionData, siteData){

  var elements = $(siteData.nextBtn);

  logger("Nav buttons in chapter (@ " + sessionData.token + "): " + elements.length);

  if(elements.length !== 0){
    sessionData.nextLink = elements.attr('href');
    return true;

  }

  return false;
}

/*check if currentLink is main page and update novel info if possible*/
function novelInfoAndUpdateNext($, sessionData, siteData){

 var elements = $(siteData.readChapterBtn);

 logger("Nav buttons in main (@ " + sessionData.token + "): " + elements.length);

 if(elements.length !== 0){

   getMainPage($, sessionData, siteData);
   sessionData.nextLink = elements.attr('href');

   return true;
 }

 return false;
}


/*select functions based on website*/
function getChapterAndWriteToFile($, sessionData, siteData){

  if(sessionData.writeStream.socket._writableState.ended)
  return false;

  var content = null;
  switch(siteData.id){
    case 0:
    content = novelBuddyChapter($, sessionData);
    break;
  }

  if(content){
  sessionData.errorTick = 0;
  return writeToFile(sessionData);
  }

  sessionData.errorTick++;
  return false;
}


function getMainPage($, sessionData, siteData){
  switch(siteData.id){
    case 0:
    novelBuddyMainPage($, sessionData);
    sessionData.errorTick = 0;
    break;

    default:
    sessionData.errorTick++;
  }
}

   /*Custom Code for each website */

function novelBuddyChapter($, sessionData){

  var chDetails = sessionData.currentLink.split("/")[4].split("-");

  sessionData.chapter.num = chDetails[1];

  sessionData.chapter.name = chDetails.splice(2, chDetails.length - 2).join(" ");

//check if class name matches website
  sessionData.chapter.content = $('.content-inner').children('p').map(function(){
    return $(this).text();
  }).get().join('\n\n');


  return sessionData.chapter.content;
}


function novelBuddyMainPage($, sessionData){
    //check if class name matches website
  $('.author').children('a').each(function () {
    sessionData.author.push($(this).attr('title'));
  });

  sessionData.summary = $('.summary').children('.content').text().trim();
}

/*      End custom code                       */


/*write data to file using a write stream */
function writeToFile(sessionData){

  if(!sessionData.chapter.content)
  return;

  var novel = '';

  if(!sessionData.fileName){

    sessionData.title  = sessionData.currentLink.split("/")[3].split("-").join(" ");

    novel = "Title: " + sessionData.title + "\nAuthor(s):";

    for(let i = 0; i < sessionData.author.length; i++)
    novel += "\n" + sessionData.author[i];

    novel += "\n\nSummary\n" + sessionData.summary;

    sessionData.fileName = sessionData.title + "_" + sessionData.chapter.num + '@' + sessionData.token  + '.txt';

  }

  novel += "\n\nChapter " + sessionData.chapter.num + " " + sessionData.chapter.name + "\n\n" + sessionData.chapter.content;


       /*CLIENT DISK VERSION */
  return writeToClient(sessionData, novel);

     /* SERVER DISK VERSION*/
 //writeToServer(sessionData, novel);

}

  /*CODE FOR WRITING TO CLIENT DISK*/
async function writeToClient(sessionData, novel){

try{

  if(!sessionData.writeStream.headersSent){
    sessionData.writeStream.writeHead(200, {
      'Content-Type': 'text/plain',
      'Content-Disposition': 'attachment; filename=' + sessionData.fileName
    });
   }

}catch (err){
  logger("\n\n\nStream Header write Error (@ " + sessionData.token + "): " + err.message);
  return false;
}

var canWrite  = sessionData.writeStream.write(novel, () =>{
    sessionData.chapter.content = null;
    logger("Session " + sessionData.token + ": " + "Novel " +
    sessionData.title + " Chapter " + sessionData.chapter.num + ' written!');
 });

   if(!canWrite)
   await drain(sessionData);
   else
   sessionData.writeStream.removeAllListeners('drain');
}

async function drain(sessionData){
  return new Promise((resolve, reject) => {sessionData.writeStream.once('drain', resolve);});
}

/*CODE FOR WRITING TO SERVER DISK*/
// async function writeToServer(sessionData, novel){
// var canWrite = true;
//
//   if(!sessionData.writeStream){
//
//      logger("\n\n\nCreate stream : " + sessionData.fileName);
//      sessionData.writeStream = fs.createWriteStream(DOWNLOADS_PATH + '/' + sessionData.fileName, {flags: 'a+'});
//
//      sessionData.writeStream.once('ready', ()=>{
//        logger("\nReady to write: " + sessionData.fileName);
//        canWrite = writeServerFile(sessionData, novel);
//      });
//
//     sessionData.writeStream.once('error', (err)=>{
//        logger("\n\n\nStream Write Error (@ " + sessionData.token + "): " + err.message);
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
//       logger("Session " + sessionData.token + ": " + "Novel " +
//       sessionData.title + " Chapter " + sessionData.chapter.num + ' written!');
//    });
// }

 /*Run at server start*/
app.listen(PORT, function(){

logger("\n\n\nServer started");
logger("\n\n\nListening on port: " + PORT);
loadSiteMap();

             /*CODE FOR WRITE ON SERVER DISK */
 //  fs.access(DOWNLOADS_PATH, fs.constants.F_OK, (err) => {
 //
 //    if(err && err.code === 'ENOENT'){  //no folder, then create
 //     logger("\n\n\nFolder Access Error: " + err.message);
 //     logger("\nCreating directory...");
 //      fs.mkdirSync(DOWNLOADS_PATH);
 //    }else if(err){
 //      logger("\n\n\nSomething went wrong!\nFolder Access Error: " + err.message); //other errors
 //      process.exit(1);
 //    }  else {
 //      logger("\n\n\n" + DOWNLOADS_PATH +  " already exists!");  //folder exists
 //    }
 //
 // });

});


       /*load sites from JSON file */
function loadSiteMap(){
  logger("\n\n\nLoading Site Maps.");

  try{
    JSON.parse(fs.readFileSync(SITES_JSON_PATH)).forEach(site =>{
      loadSite(site);
    });
  }catch(err){
    logger("\n\n\nJSON File Read Error: " + err);
    logger("\nUsing default sites.\n");
    loadDefaultSiteMap();
  }
}

function loadDefaultSiteMap(){
  sites.forEach( site => {
    loadSite(site);
  });
}

function loadSite(site){
  siteMap.set(site.baseURL.split('/')[2], site);
  logger("Loading site: " + site.baseURL);
}



                               /*DEBUGGING LOGS*/

//const logFile = fs.createWriteStream(PATH + '/' + "logger.txt", {flags: 'w+'});

// logFile.on('error', (err)=>{
//
// console.log("Logging Error: " + err.message);
// });


var logger = function(obj){

  if(typeof obj !== 'string')
    obj = util.inspect(obj);

  console.log(obj);
//  logFile.write(obj + " at " + Date() + '\n');
}

/*write memory usage every 10 minutes */

setInterval(function () {
  if (typeof gc === 'function') {
    gc();
  }
  logger(process.memoryUsage());
}, 600000);
