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

  // ดึงรายการออเดอร์ที่อยู่ในคิว
  let temp = await getOrderItemInQueue();

  // ตรวจสอบ ว่าแต่ละ menu มี extra task และต้อง reorder point หรือไม่?
  let extraTask = await checkExtraTask(orders);
// console.log('extraTask', extraTask);
  orders = orders.concat(extraTask);

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
    let available = await getStartTimeByCheckAvailableStation(
      task.work_station_id, 
      needStart
    );
    // "2020-11-25T08:29:47.417Z"
    // --> res = time to start task after check work station

    let taskStart = available;
    
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
      let lastTime = endTime;
      for (let s = 0; s < subTasks.length; s++) {
        let sTask = subTasks[s];
        let subTaskStart = datetime.moment(
          lastTime.format(fullFormat)).add(1, 'minutes');
        let subTaskEnd = datetime.moment(
          subTaskStart.format(fullFormat)).add(+sTask.cooking_time, 'minutes');
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
  console.log('----->task', task.name, task.task_type, task.cooking_time, start.format(fullFormat));
  // // console.log('task', task);

  let vacant = [];
  let chiefs = await totalChief();
  let allTasks = temp;
  // let allTasks = await getOrderItemInQueue(temp);
  // console.log('allTasks', JSON.stringify(allTasks));

  for (let i = 0; i < chiefs.length; i++) {
    let chief = chiefs[i];
    // find all chief's task

    // no task in hand
    let chiefTasks = allTasks.filter((r) => r.user_id == chief.user_id);
    if (chiefTasks.length == 0) {
      // TODO return this chief;
      return {
        user_id: chief.user_id,
        start: start.format(fullFormat),
      };
      // continue;
    }

    for (let j = 0; j < chiefTasks.length; j++) {
      let current = chiefTasks[j];
      // console.log('current', current.menu_name, current.task_type, current.children.length);
      let cTaskStart = new moment(current.expected_start_at);
      let ctask = new moment(current.expected_end_at).add(1, 'minutes');
      // สามารถทำพร้อมฉันได้นะ ฉันเป็นของทอดหรือย่าง - provide start time
      // console.log('current.task_type', current.task_type);
      if (['fries', 'grill'].includes(current.task_type)) {
        // console.log('current.children', current.children);
        if ((current.children || []).length > 0) {
          for (let c = 0; c < current.children.length; c++) {
            let child = current.children[c];
            let childCtask = new moment(child.expected_end_at).add(1, 'minutes');
            let noNextChild = c + 1 == current.children.length;
            if (noNextChild) {
              let c_ntask = new moment(current.expected_end_at);
              let c_duration = new moment.duration(c_ntask.diff(childCtask));
              // console.log('noNextChild', noNextChild, current.ref_id, c_duration.minutes());
              vacant.push({
                // main_order_item_id: current.order_item_id,
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
          vacant.push({
            // main_order_item_id: current.order_item_id,
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
          vacant.push({
            user_id: chief.user_id,
            start: ctask.format(fullFormat),
            duration: 100000,
          });
          continue;
        }

        let next = chiefTasks[j + 1];

        // duration between task
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
  // sel = _.orderBy(sel, ['start', 'plus_time'], ['asc', 'asc']);
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
  let selectedStart = selected.start < start.format(fullFormat) ? start.format(fullFormat) : selected.start;
  let sres = {
    ...selected,
    user_id: selected.user_id,
    start: selectedStart,
  };
  // console.log('sres', sres);
  return sres;
}

async function getStartTimeByCheckAvailableStation(stationId, needStart) {
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

  let stationInfo = resWork[0];

  // check max capacity
  let sqlu = SELECT_USED_WORK_STATION;
  sqlu = sqlu.replace('$work_station_id', stationId);
  sqlu = sqlu.replace('$expected_end_at', needStart.format(fullFormat));
  let res = await db.query(sqlu);
  let used = res.length;
  let qty = stationInfo.qty;
  // console.log('used < qty', used < qty);
  if (used < qty) {
    return datetime.moment(needStart).add(1, 'minutes');
  }

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
      let totalRemain = (+extra.remaining || 0) + (+extra.qty_cooking || 0) - item.qty;
      if (extra.reorder_point == null) {
        continue;
      }

      if (totalRemain <= extra.reorder_point) {
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




