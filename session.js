
const activeSession = new Map();

/*session token generator*/
exports.generateToken = function () {
  let token = "";
  let count = 0;
  let val = 0;
  let n = 0;
  do {
    val = Math.floor(Math.random() * 26);
    n = Math.floor(Math.random() * 2);

    switch (n) {
      case 0:
        n = 65;
        break;
      case 1:
        n = 97;
    }

    val += n;
    token += String.fromCharCode(val);
  } while (count++ < 5);

  return token;
}

exports.isSession = function(token) {
  return activeSession.has(token);
}

exports.addSession = function (sessionData) {
  activeSession.set(sessionData.token, sessionData);
}

exports.getSession = function (token) {
  return activeSession.get(token);
}

exports.endSession = function(token){
  return activeSession.delete(token);
}
