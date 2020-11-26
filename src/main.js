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
  SELECT_LAST_QUEUE_NUMBER,
  SELECT_USED_WORK_STATION,
  INSERT_ORDER_ITEM_GROUP,
  SELECT_ITEM_IN_QUEUE,
  SELECT_ITEM_GROUP_BY_MAIN,
  SELECT_EXTRA_MENU_BY_MAIN_MENU,
} from './sql_const';
import { datetime } from './utils/time';

let CONF_PLUS_EXTRA_TIME = 2;
let CONF_CLOSE_TIME = '17:00:00';
let fullFormat = 'YYYY-MM-DD HH:mm:ss';

async function start(orders) {
  let data = await cal(orders);

  // assigne queue
  let lastQueue = await getLastQueue();
  let queue = lastQueue;
  for (let i = 0; i < data.length; i++) {
    data[i].queue_number = queue;
    queue++;
  }
  // let ins = await insertOrder(data);
}

async function cal(orders) {
  let orderDate = datetime.moment();

  // ไว้สำหรับเก็บรายการ ที่ calcualte แล้ว
  // ดึงรายการออเดอร์ที่อยู่ในคิว
  let temp = await getOrderItemInQueue();

  // ตรวจสอบ ว่าแต่ละ menu มี extra task และต้อง reorder point หรือไม่?
  let extraTask = await checkExtraTask(orders);
// console.log('extraTask', extraTask);
  orders = orders.concat(extraTask);

  // ดึงขอมูล task ของรายการที่สั่งเข้ามา
  // max_cooking, cooking_time, work_station_id เฉพาะ main task - sequence 1
  let tasks = await getMenuInfoMainTask(orders);

  // เช็คจำนวนที่สามารถทำพร้อมกันได้สูงสุง & splt qty
  tasks = await splitFromMaxCooking(tasks);

  // สร้าง ref if สำหรับ item ที่ยังไม่มี order_item_id
  // ใช้สำหรับ reference ให้รายการที่สามารถทำพร้อมกันได้
  let ref_id = 1;
  // วน add item 
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
    let can_do_x_extra_task = chief.ref_id != undefined;
    if (can_do_x_extra_task == false) {
      // ADD MAIN TASK
      let startTime = chief.start;
      let endTime = datetime.moment(startTime).add(+task.cooking_time, 'minutes');
      let mainTask = {
        ref_id: ref_id,
        expected_start_at: startTime,
        expected_end_at: endTime.format(fullFormat),
        menu_id: task.menu_id,
        qty: task.qty,
        user_id: chief.user_id,
        task_type: task.task_type,
        // debug var
        menu_name: task.menu_name,
        cooking_time: task.cooking_time,
        task_id: task.task_id,
        children: [],
      };
      temp.push(mainTask);
      ref_id++;
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
          ref_id: ref_id,
          expected_start_at: subTaskStart.format(fullFormat),
          expected_end_at: subTaskEnd.format(fullFormat),
          menu_id: sTask.menu_id,
          qty: task.qty,
          user_id: chief.user_id,
          task_type: sTask.task_type,
          // debug var
          menu_name: sTask.menu_name,
          cooking_time: sTask.cooking_time,
          task_id: sTask.task_id,
        };
        lastTime = subTaskEnd;
        temp.push(subTask);
        ref_id++;
      }
    } else {
      // ออเดอร์ที่สามารถทำพร้อม task ทอด หรือ ย่างได้
      for (let j = 0; j < temp.length; j++) {
        let tempItem = temp[j];
        if (tempItem.ref_id == chief.ref_id) {
          let childTask = {
            expected_start_at: chief.start,
            expected_end_at: chief.end,
            menu_id: task.menu_id,
            qty: task.qty,
            user_id: tempItem.user_id,
            task_type: task.task_type,
            // debug var
            menu_name: task.menu_name,
            cooking_time: task.cooking_time,
            task_id: task.task_id,
          };
          temp[j].children.push(childTask);
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
    let chiefTasks = allTasks.filter((r) => r.user_id == chief.user_id);
    // no task in hand
    // ถ้าเค้าว่าง
    if (chiefTasks.length == 0) {
      // TODO return this chief;
      return {
        user_id: chief.user_id,
        start: start.format(fullFormat),
      };
      // continue;
    }

    // วนลูปแต่ละ task เพื่อหา gap ที่เค้าว่าง
    for (let j = 0; j < chiefTasks.length; j++) {
      let current = chiefTasks[j];
      // console.log('current', current.menu_name, current.task_type, current.children.length);
      let cTaskStart = new moment(current.expected_start_at);
      let ctask = new moment(current.expected_end_at).add(1, 'minutes');

      // สามารถทำพร้อมฉันได้นะ ฉันเป็นของทอดหรือย่าง - provide start time
      if (['fries', 'grill'].includes(current.task_type)) {
        // มี task อื่นที่ทำพร้อมอยู่
        if ((current.children || []).length > 0) {
          // วนลูป task ที่ทำพร้อมกันอยู่ ว่ามี gap ว่างมั้ย 
          for (let c = 0; c < current.children.length; c++) {
            let child = current.children[c];
            let childCtask = new moment(child.expected_end_at).add(1, 'minutes');
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
                ref_id: current.ref_id,
                plus_time: CONF_PLUS_EXTRA_TIME,
                user_id: chief.user_id,
                start: childCtask.format(fullFormat),
                duration: c_duration.minutes(),
              });
              continue;
            }
          }
        } else {
          // ไม่มี task อื่นทำพร้อมกัน
          // เวลาเริ่ม = เริ่มได้พร้อมของทอด
          vacant.push({
            ref_id: current.ref_id,
            plus_time: CONF_PLUS_EXTRA_TIME,
            user_id: chief.user_id,
            start: cTaskStart.format(fullFormat),
            duration: 100000,
          });
        }
      } else {
        // เวลา ถัดไป แบบว่าง ๆ ไม่มี task อื่นมาคั่น
        let noNextTask = j + 1 == chiefTasks.length;
        if (noNextTask) {
          // เวลาเริ่ม = เวลาสิ้นสุดของ task นี้
          vacant.push({
            user_id: chief.user_id,
            start: ctask.format(fullFormat),
            duration: 100000,
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
          let dstart = moment(current.expected_end_at).add(1, 'minutes').format(fullFormat);
          vacant.push({
            user_id: chief.user_id,
            start: dstart,
            duration: duration.minutes(),
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
  sel = _.orderBy(sel, ['end'], ['asc']);
  console.log('sel', JSON.stringify(sel));
  console.log('-----------------');
  if (sel.length == 0) {
    return {
      user_id: chiefs[0].user_id,
      start: start.format(fullFormat),
    };
  }

  let selected = sel[0];
  // ถ้าเวลาเริ่มที่เลือกให้ < เวลาที่ต้องการเริ่ม ให้เริ่มจากเวลาที่ต้องการเริ่ม
  // ex. เริ่มได้ 12:32:00, ต้องการเริ่ม  12:34:00
  let selectedStart = selected.start < start.format(fullFormat) ? start.format(fullFormat) : selected.start;
  let sres = {
    ...selected,
    user_id: selected.user_id,
    start: selectedStart,
  };
  return sres;
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
  let sql = 'SELECT * FROM users WHERE user_type = "chief"';
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
  let fries = items.filter((r) => r.task_type == 'fries');
  fries = _.orderBy(fries, ['cooking_time'], ['asc']);
  let other = items.filter((r) => r.task_type != 'fries');
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
      sql_items = sql_items.replace('$status', 'queue');
      sql_items = sql_items.replace('$expected_start_at', order.expected_start_at);
      sql_items = sql_items.replace('$expected_end_at', order.expected_end_at);
      sql_items = sql_items.replace('$user_id', order.user_id);
      sql_items = sql_items.replace('$task_id', order.task_id);
      sql_items = sql_items.replace('$qty', order.qty);
      sql_items = sql_items.replace('$order_id', orderId);
      // console.log('sql_items', sql_items);
      let resInsItem = await db.query(sql_items);
      orderItemId = resInsItem.insertId;
    } else {
      orderItemId = order.order_item_id;
    }

    for (let j = 0; j < (order.children || []).length; j++) {
      let child = order.children[j];
      if (child.main_order_item_id != undefined && child.sub_order_item_id != undefined) {
        continue;
      }

      let sql_child_item = INSERT_ORDER_ITEMS;
      sql_child_item = sql_child_item.replace('$queue_number', order.queue_number);
      sql_child_item = sql_child_item.replace('$status', 'queue');
      sql_child_item = sql_child_item.replace('$expected_start_at', child.expected_start_at);
      sql_child_item = sql_child_item.replace('$expected_end_at', child.expected_end_at);
      sql_child_item = sql_child_item.replace('$user_id', child.user_id);
      sql_child_item = sql_child_item.replace('$task_id', child.task_id);
      sql_child_item = sql_child_item.replace('$qty', child.qty);
      sql_child_item = sql_child_item.replace('$order_id', orderId);
      let resInsChildItem = await db.query(sql_child_item);

      // insert group
      let sql_ins_group = INSERT_ORDER_ITEM_GROUP;
      sql_ins_group = sql_ins_group.replace('$main_order_item_id', orderItemId);
      sql_ins_group = sql_ins_group.replace('$sub_order_item_id', resInsChildItem.insertId);
      await db.query(sql_ins_group);
    }
  }
  // console.log('orderId', JSON.stringify(orders));
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
  res = await findOrderItemGroup(res);
  // res = res.concat(temp);
  return res;
}

async function findOrderItemGroup(orderItems) {
  let arrayIds = orderItems.map((t) => t.order_item_id);
  if (arrayIds.length == 0) {
    return orderItems;
  }
  let stringIds = arrayIds.join(',');
  let sql = SELECT_ITEM_GROUP_BY_MAIN;
  sql = sql.replace('$main_order_item_id', stringIds);
  let res = await db.query(sql);

  for (let j = 0; j < orderItems.length; j++) {
    let children = res.filter((r) => r.main_order_item_id == orderItems[j].order_item_id) || [];
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


start(items);




