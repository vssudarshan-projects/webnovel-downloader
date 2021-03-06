$(document).ready(function () {
  //enable for JavaScript
  $("form").animate({ opacity: 1 });
  $("#nChoice").attr("disabled", false);
  $("#nLink").attr("disabled", false);

  //get session token
  callAjax("/start", "POST").done((token) => {
    $("#token").val(token);
  }).fail((data, status)=>{
    alert("There was an error! Contact system administrator.");
    clearInterval(ping);
  });

  //on custom choice enable text box
  $("#nChoice").on("change", function () {
    if ($(this).val() === "2") {
      $("#nChapter").attr("disabled", false);
      $("#nChapter").val(25);
    } else {
      $("#nChapter").attr("disabled", true);
      $("#nChapter").val("");
    }
  });

  //text box number validation
  $("#nChapter").on("input", function () {
    if (isNaN(Number($(this).val()))) {
      $(this).val(25);
    }
  });

  //textbox basic link validation
  $("#nLink").on("input", function () {
    if ($(this).val().length != 0 && !$(this).val().split("").includes(" "))
      $("#get-novel-btn").attr("disabled", false);
    else {
      $("#get-novel-btn").attr("disabled", true);
    }
  });
});

//call server to stop session
window.addEventListener("beforeunload", function (event) {
  callAjax("/stop", "POST");
  //   event.returnValue = "";
});

//ping server to continue session
var ping = setInterval(function () {

    callAjax("/ping", "POST")
      .done((res) => {
        if (res === "406"){
          $("#token").val('');
          clearInterval(ping);
        }
      })
      .fail(() => {
        $("#token").val('');
        clearInterval(ping);
      });

}, 30000);

//Ajax function to send data
function callAjax(url, method) {
  return $.ajax({
    url: url,
    method: method,
    responseContent: "text",
    data: $("#token").serialize(),
  });
}
