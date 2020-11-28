import moment from 'moment';
import express from 'express';
import _, { ceil } from 'lodash';

import db from './utils/db';
import './data/menu';
import { items } from './data/orders';
import {
  SELECT_MENU_SUB_TASKS,
  SELECT_MENU_MAIN_TASKS,
  SELECT_LAST_ORDER_NUMBER,
  INSERT_ORDER_ITEMS,
  INSERT_CHILD_ORDER_ITEMS,
  INSERT_EXTRA_MENU_ITEMS,
  SELECT_LAST_QUEUE_NUMBER,
  SELECT_USED_WORK_STATION,
  SELECT_ITEM_IN_QUEUE,
  SELECT_PARALLEL_ITEM_BY_MAIN,
  SELECT_EXTRA_MENU_BY_MAIN_MENU,
} from './sql_const';
import { datetime } from './utils/time';

let CONF_PLUS_EXTRA_TIME = 2;
let CONF_CLOSE_TIME = '17:00:00';
let fullFormat = 'YYYY-MM-DD HH:mm:ss';
let minFormat = 'HH:mm';

// CONF
const PARALLEL_TYPE_MAIN = 1;
const PARALLEL_TYPE_PARALLEL = 2;

const TASK_TYPE_COOK = 1;
const TASK_TYPE_FRIE = 2;
const TASK_TYPE_DERESS = 3;
const TASK_TYPE_GRILL = 4;

const ITEM_STATUS_QUEUE = 1;
const ITEM_STATUS_COOK = 2;
const ITEM_STATUS_FINISHED = 3;
const ITEM_STATUS_CANCELLED = 4;

const SOURCE_ORDER_ITEMS = 'order_items';
const SOURCE_ORDER_CHIEF = 'chief';

async function start(orders) {
  let data = await cal(orders);

  // assigne queue
  let lastQueue = await getLastQueue();
  let queue = lastQueue;
  for (let i = 0; i < data.length; i++) {
    data[i].queue_number = queue;
    queue++;
  }

  debugData(data);
  // let ins = await insertOrder(data);
}

async function cal(orders) {
  // let orderDate = datetime.moment();
  let orderDate = datetime.moment('2020-11-28 12:22:00');

  // ไว้สำหรับเก็บรายการ ที่ calcualte แล้ว
  // ดึงรายการออเดอร์ที่อยู่ในคิว
  let temp = await getOrderItemInQueue();
  // let temp = [];
  // ตรวจสอบ ว่าแต่ละ menu มี extra task และต้อง reorder point หรือไม่?
  let extraTask = await checkExtraTask(orders);
  orders = orders.concat(extraTask);

  // ดึงขอมูล task ของรายการที่สั่งเข้ามา
  // max_cooking, cooking_time, work_station_id เฉพาะ main task - sequence 1
  let tasks = await getMenuInfoMainTask(orders);

  // เช็คจำนวนที่สามารถทำพร้อมกันได้สูงสุง & splt qty
  tasks = await splitFromMaxCooking(tasks);
  // console.log('tasks', JSON.stringify(tasks));
  
  // สร้าง ref if สำหรับ item ที่ยังไม่มี order_item_id
  // ใช้สำหรับ reference ให้รายการที่สามารถทำพร้อมกันได้
  // for (let i = 0; i < tasks.length; i++) {
  //   tasks[i].ref_id = ref_id;
  //   ref_id++;
  // }

  // วน add item 
  let refId = 1;
  for (let i = 0; i < tasks.length; i++) {
    let task = tasks[i];

    let needStart = orderDate;
    // check work station
    let available = await getStartTimeByCheckAvailableStation(
      task.work_station_id, 
      needStart
    );
    // "2020-11-25T08:29:47.417Z"
    // --> res = time to start task after check work station

    let taskStart = available;
    
    // หาแม่ครัวที่ทำงานเสร็จเร็วที่สุด เพื่อลองคำนวณเวลา
    // หารายการ gap ที่แม่ครัวว่าง ดูจากเวลาสิ้นสุดของแต่ละ task และเวลาเริ่มต้นของ task ถัดไป
    let chief = await selectChief(task, taskStart, temp);
    // --> res = time to start task after check work station

    // สามารถทำพร้อมรายการทอด หรือย่างได้
    let can_do_x_extra_task = chief.parallel_parent_id != undefined;
    if (can_do_x_extra_task == false) {
      // ADD MAIN TASK
      let startTime = chief.start;
      let endTime = datetime.moment(startTime).add(+task.cooking_time, 'minutes');
      let mainTask = {
        ref_id: refId,
        expected_start_at: startTime,
        expected_end_at: endTime.format(fullFormat),
        menu_id: task.menu_id,
        qty: task.qty,
        worker_id: chief.worker_id,
        task_type: task.task_type,
        parallel_type: task.parallel_type,
        is_extra_menu: task.is_extra_menu,
        // debug var
        menu_name: task.menu_name,
        cooking_time: task.cooking_time,
        task_id: task.task_id,
        children: [],
      };
      temp.push(mainTask);
      refId++;
      // ADD SUB TASK
      // เช่น จัดจานเฟรนฟราย, จัดจานไก่ทอด
      let subTasks = await getSubTask(task.menu_id);

       // เวลาที่เสร็จของ task หลัก
      let lastTime = endTime;
      for (let s = 0; s < subTasks.length; s++) {
        let sTask = subTasks[s];
        let subTaskStart = datetime.moment(lastTime.format(fullFormat)).add(1, 'minutes');
        let subTaskEnd = datetime.moment(subTaskStart.format(fullFormat)).add(+sTask.cooking_time, 'minutes');
        let subTask = {
          ref_id: refId,
          expected_start_at: subTaskStart.format(fullFormat),
          expected_end_at: subTaskEnd.format(fullFormat),
          menu_id: sTask.menu_id,
          qty: task.qty,
          worker_id: chief.worker_id,
          task_type: sTask.task_type,
          parallel_type: sTask.parallel_type,
          is_extra_menu: sTask.is_extra_menu,
          // debug var
          menu_name: sTask.menu_name,
          cooking_time: sTask.cooking_time,
          task_id: sTask.task_id,
        };
        lastTime = subTaskEnd;
        temp.push(subTask);
        refId++;
      }
    } else {
      // ออเดอร์ที่สามารถทำพร้อม task ทอด หรือ ย่างได้
      for (let j = 0; j < temp.length; j++) {
        let tempItem = temp[j];
        // console.log('tempItem.ref_id', tempItem.ref_id, chief.parallel_parent_id);
        if (tempItem.ref_id == chief.parallel_parent_id) {
          let childTask = {
            ref_id: refId,
            expected_start_at: chief.start,
            expected_end_at: chief.end,
            menu_id: task.menu_id,
            qty: task.qty,
            worker_id: tempItem.worker_id,
            task_type: task.task_type,
            parallel_type: task.parallel_type,
            is_extra_menu: task.is_extra_menu,
            // debug var
            menu_name: task.menu_name,
            cooking_time: task.cooking_time,
            task_id: task.task_id,
          };

          if (temp[j].children == undefined) temp[j].children = [];
          temp[j].children.push(childTask);
          refId++;
        }
      }
    }
  }
  return temp;
}

async function selectChief(task, start, temp) {
  let vacant = [];
  // ดึงข้อมูลแม่ครัว
  let chiefs = await totalChief();
  let allTasks = temp;

  // วน loop ตามจำนวนของ แม่ครัว
  for (let i = 0; i < chiefs.length; i++) {
    let chief = chiefs[i];
    // find all chief's task

    // filter เฉพาะงานของ แม่ครัวคนนั้น
    let chiefTasks = allTasks.filter((r) => r.worker_id == chief.worker_id);
    // no task in hand
    // ถ้าเค้าว่าง
    if (chiefTasks.length == 0) {
      // TODO return this chief;
      return {
        worker_id: chief.worker_id,
        start: start.format(fullFormat),
      };
      // continue;
    }

    // วนลูปแต่ละ task เพื่อหา gap ที่เค้าว่าง
    for (let j = 0; j < chiefTasks.length; j++) {
      let current = chiefTasks[j];

      let ctask = new moment(current.expected_end_at).add(1, 'minutes');
      // สามารถทำพร้อมฉันได้นะ ฉันเป็นของทอดหรือย่าง - provide start time
      if (current.parallel_type == PARALLEL_TYPE_MAIN && task.parallel_type == PARALLEL_TYPE_PARALLEL) {
        // console.log('current', current.menu_name, current.task_type, current.parallel_type, task.parallel_type);
        // มี task อื่นที่ทำพร้อมอยู่
        if ((current.children || []).length > 0) {
          // วนลูป task ที่ทำพร้อมกันอยู่ ว่ามี gap ว่างมั้ย 
          for (let c = 0; c < current.children.length; c++) {
            let child = current.children[c];
            let childCtask = new moment(child.expected_end_at).add(1, 'minutes');
            if (childCtask.format(fullFormat) < start.format(fullFormat)) {
              childCtask = start;
            }              
            let noNextChild = c + 1 == current.children.length;
            if (noNextChild) {
              // ใช้เวลาที่สิ้นสุดของตัวลูก เป็น start
              // ใช้เวลาที่สิ้นสุดของตัวแม่ เป็น end
              // ทอดไก่   12:21	12:36
              // ยำวุ้นเส้น 12:21	12:26
              // มี gap ว่างอยู่ 10 นาที
              let c_ntask = new moment(current.expected_end_at);
              let c_duration = new moment.duration(c_ntask.diff(childCtask));
              vacant.push({
                parallel_parent_id: current.ref_id,
                plus_time: CONF_PLUS_EXTRA_TIME,
                worker_id: chief.worker_id,
                start: childCtask.format(fullFormat),
                duration: c_duration.minutes(),
                flag: "A",
              });
              continue;
            }
          }
        } else {
          // ไม่มี task อื่นทำพร้อมกัน
          // เวลาเริ่ม = เริ่มได้พร้อมของทอด
          let mainStart = new moment(current.expected_start_at);
          if (mainStart.format(fullFormat) < start.format(fullFormat)) {
            mainStart = start;
          }

          let mDuration = moment.duration(ctask.diff(mainStart));
          if (mDuration > 1) {
            vacant.push({
              parallel_parent_id: current.ref_id,
              plus_time: CONF_PLUS_EXTRA_TIME,
              worker_id: chief.worker_id,
              start: mainStart.format(fullFormat),
              // duration: mDuration.minutes(),
              duration: 10000,
              flag: "B",
            });
          }
        }
      } else {
        // เวลา ถัดไป แบบว่าง ๆ ไม่มี task อื่นมาคั่น
        let noNextTask = j + 1 == chiefTasks.length;
        if (ctask.format(fullFormat) < start.format(fullFormat)) {
          ctask = start;
        }
        if (noNextTask) {
          // เวลาเริ่ม = เวลาสิ้นสุดของ task นี้
          vacant.push({
            worker_id: chief.worker_id,
            plus_time: 0,
            start: ctask.format(fullFormat),
            duration: 100000,
            flag: "C",
          });
          continue;
        }

        let next = chiefTasks[j + 1];
        // duration between task
        // เอาเวลาสิ้นสุดของ task นี้ = กับเวลาเริ่มของ task ถัดไป มัน diff กัน
        // แล้วใส่เปน duration
        let ntask = new moment(next.expected_start_at);
        let duration = moment.duration(ctask.diff(ntask));
        if (duration > 1) {
          vacant.push({
            worker_id: chief.worker_id,
            plus_time: 0,
            start: ctask.format(fullFormat),
            duration: duration.minutes(),
            flag: "D",
          });
        }
      }
    }
  }

  // console.log('vacant', JSON.stringify(vacant));
  // console.log('-----------------', start.format(fullFormat));
  
  // prepare เวลาสิ้นสุด = เอาเวลาเริ่ม + cooking time + (extra_time) ถ้ามี
  let sel = vacant
    .filter((v) => v.duration >= task.cooking_time + (v.plus_time || 0))
    .map((v) => {
      v.cooking_time = task.cooking_time;
      v.end = datetime
        .moment(v.start)
        .add(+task.cooking_time + (+v.plus_time || 0), 'minutes')
        .format(fullFormat);
      return v;
    });
  // เรียงตามเวลาที่เสร็จเร็วสุด
  sel = _.orderBy(sel, ['end', 'plus_time'], ['asc', 'asc']);
  console.log('sel', JSON.stringify(sel));
  console.log('-----------------', task.menu_name);
  
  if (sel.length == 0) {
    return {
      worker_id: chiefs[0].worker_id,
      start: start.format(fullFormat),
    };
  }

  let selected = sel[0];
  // console.log('selected', selected);
  return selected;
  // // ถ้าเวลาเริ่มที่เลือกให้ < เวลาที่ต้องการเริ่ม ให้เริ่มจากเวลาที่ต้องการเริ่ม
  // // ex. เริ่มได้ 12:32:00, ต้องการเริ่ม  12:34:00
  // let selectedStart = selected.start < start.format(fullFormat) ? start.format(fullFormat) : selected.start;
  // let sres = {
  //   ...selected,
  //   worker_id: selected.worker_id,
  //   start: selectedStart,
  // };
  // return sres;
}

async function getStartTimeByCheckAvailableStation(stationId, needStart) {
  // กรณีต้อง check work station พวกยำวุ้นเส้น, จัดจานเฟรนฟราย
  if (stationId == null) {
    return datetime.moment(needStart).add(1, 'minutes');
  }

  // get work station info
  let sql = `SELECT * FROM rimna_db.work_stations 
  WHERE work_station_id = '${stationId}' ORDER BY work_station_id;`;
  let resWork = await db.query(sql);
  if (resWork.length == 0) {
    return datetime.moment(needStart).add(1, 'minutes');
  }

  // ได้ข้อมูล work station นั้น
  let stationInfo = resWork[0];

  // check max capacity
  // ดูว่าเวลาที่เราต้องการใช้มีคนใช้อยู่รึป่าว ?
  // ดูจาก รายการอาหารที่ทำ เวลาที่ใช้ work station นั้นเสร็จ เวลา expected_end > เวลาที่จะใช้
  let sqlu = SELECT_USED_WORK_STATION;
  sqlu = sqlu.replace('$work_station_id', stationId);
  sqlu = sqlu.replace('$expected_end_at', needStart.format(fullFormat));
  let res = await db.query(sqlu);
  let used = res.length;
  let qty = stationInfo.qty;
  // console.log('used < qty', used < qty);

  // คนใช้น้อยกว่า max capacity, สามารถใช้ได้เลย
  if (used < qty) {
    return datetime.moment(needStart).add(1, 'minutes');
  }

  // ถ้า capcity เต็ม จะใช้เวลาที่เสร็จของ station นั้น เป็นเวลาเริ่ม
  return datetime.moment(res[0].expected_end_at).add(1, 'minutes');
}

async function totalChief() {
  let sql = 'SELECT * FROM workers WHERE worker_type = "chief"';
  let results = await db.query(sql);
  // for(let i = 0; i < results.length; i++) {
  //   console.log('results', results[i].name);
  // }
  return results;
}
/**
 *
 * return menu e.g. info max_cooking, cooking_time, work_station_id
 */
async function getMenuInfoMainTask(orders) {
  let arrayIds = orders.map((t) => t.menu_id);
  let stringIds = arrayIds.join(',');

  let sql = SELECT_MENU_MAIN_TASKS.replace('$menu_id', stringIds);
  let queryResult = await db.query(sql);

  let items = [];
  for (let i = 0; i < orders.length; i++) {
    let order = orders[i];
    let info = queryResult.find((q) => q.menu_id == order.menu_id);
    items.push(_.merge(info, order));
  }

  // find priority type
  let fries = items.filter((r) => r.task_type == TASK_TYPE_FRIE);
  fries = _.orderBy(fries, ['cooking_time'], ['asc']);
  let other = items.filter((r) => r.task_type != TASK_TYPE_FRIE);
  items = fries.concat(other);
  // console.log('res', JSON.stringify(res));
  return items;
}

async function splitFromMaxCooking(items) {
  // split
  let res = [];
  for (let j = 0; j < items.length; j++) {
    let item = items[j];
    if (item.qty > item.max_cooking_same_time) {
      let round = ceil(item.qty / item.max_cooking_same_time);
      let qty = item.qty;
      for (let k = 0; k < round; k++) {
        let q = qty > item.max_cooking_same_time ? item.max_cooking_same_time : qty;
        res.push({
          ...item,
          qty: q,
        });
        qty -= item.max_cooking_same_time;
      }
    } else {
      res.push(item);
    }
  }

  // console.log('item.qty', JSON.stringify(res));
  return res;
}

async function getSubTask(orderIds) {
  let sql = SELECT_MENU_SUB_TASKS.replace('$v', orderIds);
  let res = await db.query(sql);
  return res;
}

async function insertOrder(orders) {
  let now = datetime.moment().format(fullFormat);
  let resNum = await db.query(SELECT_LAST_ORDER_NUMBER);
  let orderNumber = _.get(resNum, '0.order_number', 0) + 1;

  let sql = `INSERT INTO rimna_db.orders (order_date, order_number) VALUES ('${now}', '${orderNumber}');`;
  let resIns = await db.query(sql);
  let orderId = resIns.insertId;

  // get last queue
  for (let i = 0; i < orders.length; i++) {
    let order = orders[i];
    // insert items
    let orderItemId;
    if (order.order_item_id == undefined) {
      let sql_items = INSERT_ORDER_ITEMS;
      sql_items = sql_items.replace('$queue_number', order.queue_number);
      sql_items = sql_items.replace('$status', ITEM_STATUS_QUEUE);
      sql_items = sql_items.replace('$expected_start_at', order.expected_start_at);
      sql_items = sql_items.replace('$expected_end_at', order.expected_end_at);
      sql_items = sql_items.replace('$worker_id', order.worker_id);
      sql_items = sql_items.replace('$task_id', order.task_id);
      sql_items = sql_items.replace('$qty', order.qty);
      sql_items = sql_items.replace('$order_id', orderId);
      // console.log('sql_items', sql_items);
      let resInsItem = await db.query(sql_items);
      orderItemId = resInsItem.insertId;

      // insert to extra menu items
      if (order.is_extra_menu == true) {
        insertExtraMenuItem(orderItemId, order);
      }
    } else {
      orderItemId = order.order_item_id;
    }

    // insert parallel child menu
    for (let j = 0; j < (order.children || []).length; j++) {
      let child = order.children[j];
      if (child.parallel_parent_id != undefined) {
        continue;
      }

      let sql_child_item = INSERT_CHILD_ORDER_ITEMS;
      sql_child_item = sql_child_item.replace('$queue_number', order.queue_number);
      sql_child_item = sql_child_item.replace('$status', ITEM_STATUS_QUEUE);
      sql_child_item = sql_child_item.replace('$expected_start_at', child.expected_start_at);
      sql_child_item = sql_child_item.replace('$expected_end_at', child.expected_end_at);
      sql_child_item = sql_child_item.replace('$worker_id', child.worker_id);
      sql_child_item = sql_child_item.replace('$task_id', child.task_id);
      sql_child_item = sql_child_item.replace('$qty', child.qty);
      sql_child_item = sql_child_item.replace('$order_id', orderId);
      sql_child_item = sql_child_item.replace('$parallel_parent_id', orderItemId);
      let resInsChildItem = await db.query(sql_child_item);

      if (order.is_extra_menu == true) {
        insertExtraMenuItem(resInsChildItem, child);
      }
    }
  }
}

async function getLastQueue() {
  let res = await db.query(SELECT_LAST_QUEUE_NUMBER);
  let queue = _.get(res, '0.queue_number', 0) + 1;
  return queue;
}

async function getOrderItemInQueue() {
  let sql = SELECT_ITEM_IN_QUEUE;
  let res = await db.query(sql);
  if (res.length == 0) {
    return [];
  }
  
  // find child
  res = await findParallelOrderItem(res);
  // res = res.concat(temp);
  return res;
}

async function findParallelOrderItem(orderItems) {
  let arrayIds = orderItems.map((t) => t.order_item_id);
  if (arrayIds.length == 0) {
    return orderItems;
  }
  let stringIds = arrayIds.join(',');
  let sql = SELECT_PARALLEL_ITEM_BY_MAIN;
  sql = sql.replace('$parallel_parent_id', stringIds);
  let res = await db.query(sql);

  for (let j = 0; j < orderItems.length; j++) {
    let children = res.filter((r) => r.parallel_parent_id == orderItems[j].order_item_id) || [];
    orderItems[j].children = children;
  }
  return orderItems;
}


async function checkExtraTask(items) {
  // check time close
  // เช็คเวลาก่อนร้านปิด ไม่ต้อง reorder
  let now = moment().format(fullFormat);
  let close = moment().format(`YYYY-MM-DD ${CONF_CLOSE_TIME}`);
  if (now > close) {
    return [];
  }

  // check extra task
  let result = [];
  let arrayIds = items.map((t) => t.menu_id);
  if (arrayIds.length == 0) {
    return result;
  }
  let stringIds = arrayIds.join(',');

  // หา extra task ของแต่ละ menu
  let sql = SELECT_EXTRA_MENU_BY_MAIN_MENU;
  sql = sql.replace('$main_menu_id', stringIds);
  sql = sql.replace('$created_at', moment().format('YYYY-MM-DD'));
  // console.log('sql', sql);
  let res = await db.query(sql);

  for (let i = 0; i < items.length; i++) {
    let item = items[i];
    let hasExtra = res.filter((r) => r.main_menu_id == item.menu_id);
    if (hasExtra.length == 0) {
      continue;
    }

    for (let j = 0; j < hasExtra.length; j++) {
      let extra = hasExtra[j];

      // extra.remaining = (จำนวนที่แม่ครัวทำ + (-จำนวนที่ใช้ไปในแต่ละ order) + (จำนวนที่กำลังทำอยู่ + จำนวนที่กำลังทำแล้ว)) ในวันนั้น <-- sum จาก sql
      // จาก ตาราง extra menu item
      // item.qty = จำนวนที่สั่งเข้ามา
      // จำนวนคงเหลือ =  
      let totalRemain = (+extra.remaining || 0) - item.qty;
      if (extra.reorder_point == null) {
        continue;
      }

      if (totalRemain <= extra.reorder_point) {
        // generate extra task
        result.push({
          menu_id: extra.menu_id,
          qty: extra.default_reorder_qty,
          menu_name: extra.menu_name,
        });
      }
    }
  }

  return result;
}

async function insertExtraMenuItem(orderItemId, menuInfo) {
  let sql = INSERT_EXTRA_MENU_ITEMS;
  sql = sql.replace('$menu_id', menuInfo.menu_id);
  sql = sql.replace('$order_item_id', orderItemId);
  sql = sql.replace('$qty', menuInfo.qty);
  sql = sql.replace('$source', SOURCE_ORDER_ITEMS);
  sql = sql.replace('$created_at', moment().format(fullFormat));
  await db.query(sql);
  // let orderId = resIns.insertId;
}

async function debugData(data) {
  // 
  let res = data.map(d => {
    d.expected_start_at = moment(d.expected_start_at).format(fullFormat);
    d.expected_end_at = moment(d.expected_end_at).format(fullFormat);
    d.children = (d.children || []).map(c => {
      c.expected_start_at = moment(c.expected_start_at).format(fullFormat);
      c.expected_end_at = moment(c.expected_end_at).format(fullFormat);
      return c;
    });
    d.children = _.orderBy(d.children, ['expected_start_at'], ['asc'])
    return d;
  });

  console.log('res', JSON.stringify(res));

  // debug like table
  res = _.orderBy(res, ['expected_start_at'], ['asc']);
  let chief = await totalChief();
  //
  for(let j = 0; j < res.length; j++) {
    let info = res[j]
    let str = '';
    for(let c = 0; c < chief.length; c++) {
      let ch = chief[c];
      str += ',';
      if (info.worker_id == ch.worker_id) {
        str += `${info.menu_name},`;
      }
    }
    console.log(moment(info.expected_start_at).format(minFormat), ',',moment(info.expected_end_at).format(minFormat), ',', str);

    // 
    for(let k = 0; k < (info.children || []).length; k++) {
      let child = info.children[k];
      let cstr = '';
      for(let o = 0; o < chief.length; o++) {
        let cch = chief[o];
        cstr += ',';
        if (child.worker_id == cch.worker_id) {
          cstr += `${child.menu_name},`;
        }
      }
      console.log(moment(child.expected_start_at).format(minFormat), ',',moment(child.expected_end_at).format(minFormat), ',', cstr);
    }
  }
}

start(items);




