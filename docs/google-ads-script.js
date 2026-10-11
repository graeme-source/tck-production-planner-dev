// TCK Production Planner: send Google Ads daily spend to the Numbers page.
// Google Ads > Tools > Bulk actions > Scripts. Schedule it Daily (or Hourly).
var APP_URL = '__APP_URL__';
var KEY = '__KEY__';
var DAYS = 8; // today + the 7 days before. Set to 30 for ONE run to fill past days.

function main() {
  var account = AdsApp.currentAccount();
  var tz = account.getTimeZone();
  if (tz !== 'Europe/London') Logger.log('WARNING: this account reports in ' + tz + ', not Europe/London, so its days will not line up with the planner.');
  var today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  var cost = {};
  var dates = [];
  for (var i = DAYS - 1; i >= 0; i--) {
    var d = new Date(today + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() - i);
    var day = d.toISOString().slice(0, 10);
    dates.push(day);
    cost[day] = 0; // a day with no spend comes back with no row: that is £0
  }
  var rows = AdsApp.search('SELECT segments.date, metrics.cost_micros FROM customer ' +
    "WHERE segments.date BETWEEN '" + dates[0] + "' AND '" + today + "'");
  while (rows.hasNext()) {
    var r = rows.next();
    cost[r.segments.date] += Number(r.metrics.costMicros) / 1000000;
  }
  var body = { accountId: account.getCustomerId(), currency: account.getCurrencyCode(), timeZone: tz,
    days: dates.map(function (day) { return { date: day, cost: Math.round(cost[day] * 100) / 100 }; }) };
  var res = UrlFetchApp.fetch(APP_URL, { method: 'post', contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + KEY }, payload: JSON.stringify(body), muteHttpExceptions: true });
  Logger.log(res.getResponseCode() + ' ' + res.getContentText());
  if (res.getResponseCode() !== 200) throw new Error('The planner did not accept the spend - see the log above.');
}
