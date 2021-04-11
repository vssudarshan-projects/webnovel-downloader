/*Native node module*/
const util = require("util");


/*DEBUGGING LOGS*/

//const logFile = fs.createWriteStream(__dirname + '/' + "logger.txt", {flags: 'w+'});

// logFile.on('error', (err)=>{
//
// console.log("Logging Error: " + err.message);
// });

exports.log = function (obj) {
  if (typeof obj !== "string") obj = util.inspect(obj);

  console.log(obj);
  //  logFile.write(obj + " at " + Date() + '\n');
};
