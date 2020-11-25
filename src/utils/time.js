import moment from 'moment';

export function getDurationInMilliseconds(start) {
  const NS_PER_SEC = 1e9
  const NS_TO_MS = 1e6
  const diff = process.hrtime(start)

  return (diff[0] * NS_PER_SEC + diff[1]) / NS_TO_MS
}

class DateTime {
  now() {
    return new Date();
  }

  moment(date = '') {
    return (date) ? moment(date) : moment();
  }

  // momentTz(date = '') {
  //   return (date) ? momentTimeZone(date) : momentTimeZone();
  // }

  // today(format = 'YYYY-MM-DD HH:mm:ss') {
  //   return moment().local().format(format);
  // }

  // getDateWithoutTime(date = '') {
  //   let newDate = (date !== '') ? date : new Date();
  //   return moment(newDate).startOf('day').toDate();
  // }

  // stamp(doc) {
  //   let date = new Date();
  //   doc.created_at = (doc.created_at) ? doc.created_at : date;
  //   doc.updated_at = date;
  //   return doc;
  // }

  // formatLocal(date, format = 'YYYY-MM-DD HH:mm:ss') {
  //   return (date) ? moment(date).local().format(format) : '';
  // }

  // formatTimeZone(date, timezone = 'Asia/Bangkok') {
  //   return (date) ? momentTimeZone(date).tz(timezone) : momentTimeZone().tz(timezone);
  // }

  // isCurrentDateBetween(fromDate, toDate, zone = '') {
  //   try {
  //     if (zone) {
  //       fromDate = momentTimeZone(fromDate).tz(zone).startOf('day');
  //       toDate = momentTimeZone(toDate).tz(zone).endOf('day');
  //       let now = momentTimeZone().tz(zone);
  //       return now.isBetween(fromDate, toDate) && now.isBefore(toDate) && fromDate.isBefore(toDate);
  //     } else {
  //       fromDate = moment(fromDate).startOf('day');
  //       toDate = moment(toDate).endOf('day');
  //       return moment().isBetween(fromDate, toDate) && moment().isBefore(toDate) && fromDate.isBefore(toDate);
  //     }
  //   } catch (e) {
  //     console.log(e);
  //     return false;
  //   }
  // }

  // formatToDate(date, format) {
  //   return new Date(moment(date, format).toISOString());
  // }

  // isValidTimeZone(tz) {
  //   try {
  //     if (!Intl || !Intl.DateTimeFormat().resolvedOptions().timeZone) {
  //       throw new Error('Time zones are not available in this environment');
  //     }

  //     Intl.DateTimeFormat(undefined, { timeZone: tz });
  //     return true;
  //   } catch (ex) {
  //     return false;
  //   }
  // }
}

export const datetime = new DateTime();
