// TO DO: move to file
const ITEM_STATUS_QUEUE = 1;
const ITEM_STATUS_COOK = 2;
const ITEM_STATUS_FINISHED = 3;
const ITEM_STATUS_CANCELLED = 4;

const FIRST_SEQ = 1;

export const SELECT_MENU_MAIN_TASKS = `SELECT m.*, t.task_id, t.task_type as task_type, t.cooking_time, t.menu_id, t.work_station_id, t.sequence, t.parallel_type
FROM tasks as t 
LEFT JOIN menu as m ON t.menu_id = m.menu_id 
where m.menu_id in ($menu_id)
AND t.sequence = ${FIRST_SEQ}`;
// order by cooking_time asc, t.menu_id asc, t.sequence asc

export const SELECT_MENU_SUB_TASKS = `SELECT m.*, m.menu_name as menu_name, t.task_id, t.task_type as task_type, t.cooking_time, t.menu_id, t.work_station_id, t.sequence, t.parallel_type
FROM menu as m
LEFT JOIN tasks as t ON t.menu_id = m.menu_id 
where m.menu_id in ($v)
AND t.sequence > 1
order by cooking_time asc, t.menu_id asc, t.sequence asc`


// export const order items
export const INSERT_ORDER_ITEMS = `INSERT INTO rimna_db.order_items 
(queue_number, qty, status, expected_start_at, expected_end_at, worker_id, order_id, task_id) VALUES 
('$queue_number', '$qty', '$status', '$expected_start_at', '$expected_end_at', '$worker_id', '$order_id', '$task_id');`;

// export const order items main
export const INSERT_CHILD_ORDER_ITEMS = `INSERT INTO rimna_db.order_items 
(queue_number, qty, status, expected_start_at, expected_end_at, worker_id, order_id, task_id, parallel_parent_id) VALUES 
('$queue_number', '$qty', '$status', '$expected_start_at', '$expected_end_at', '$worker_id', '$order_id', '$task_id', '$parallel_parent_id');`;


export const INSERT_ORDER_ITEM_GROUP = `INSERT INTO rimna_db.order_item_group 
(main_order_item_id, sub_order_item_id) VALUES 
('$main_order_item_id', '$sub_order_item_id')`;

// TODO: by day
export const SELECT_LAST_ORDER_NUMBER = `SELECT order_number 
FROM orders WHERE order_number > 0 
ORDER BY order_number DESC LIMIT 1`

export const SELECT_LAST_QUEUE_NUMBER = `SELECT queue_number 
FROM order_items WHERE queue_number > 0 
ORDER BY queue_number DESC LIMIT 1`

export const SELECT_USED_WORK_STATION = `SELECT 
item.*, t.work_station_id, w.name, w.qty, t.task_type, m.menu_name
from order_items as item
LEFT JOIN tasks as t on t.task_id = item.task_id
LEFT JOIN menu as m on m.menu_id = t.menu_id
LEFT JOIN work_stations as w on w.work_station_id = t.work_station_id 
WHERE t.work_station_id = $work_station_id 
AND (expected_end_at > '$expected_end_at')
ORDER BY expected_end_at ASC`

export const SELECT_ITEM_IN_QUEUE = `SELECT item.*, m.menu_name as menu_name, t.*, t.task_type as task_type,
item.order_item_id as ref_id
from order_items as item
LEFT JOIN tasks as t on t.task_id = item.task_id
LEFT JOIN menu as m on m.menu_id = t.menu_id
WHERE parallel_parent_id is NULL AND item.status = ${ITEM_STATUS_QUEUE}`;

export const SELECT_PARALLEL_ITEM_BY_MAIN = `SELECT item.*, t.*, t.task_type as task_type, m.menu_name as menu_name,
item.order_item_id as ref_id
FROM order_items as item
LEFT JOIN tasks as t on t.task_id = item.task_id
LEFT JOIN menu as m on m.menu_id = t.menu_id
WHERE parallel_parent_id IN ($parallel_parent_id)
`;

export const SELECT_EXTRA_MENU_BY_MAIN_MENU = `SELECT e.*, m.*, m.menu_name as menu_name, 
(SELECT sum(qty) from extra_menu_items WHERE menu_id = e.extra_menu_id
AND DATE(created_at) = DATE('$created_at')) as remaining

from main_menu_with_extra_menu as e
LEFT JOIN menu as m on m.menu_id = e.extra_menu_id
WHERE e.main_menu_id IN ($main_menu_id)
`

export const INSERT_EXTRA_MENU_ITEMS = `INSERT INTO rimna_db.extra_menu_items 
(menu_id, order_item_id, qty, source, created_at) VALUES 
('$menu_id', '$order_item_id', '$qty', '$source', '$created_at');`;


export const SELECT_CAN_GROUP_IN_QUEUE_BY_TASK_ID = `SELECT m.menu_name, item.queue_number, sum(qty) as q  ,m.max_cooking_same_time as ms,  item.worker_id,
(m.max_cooking_same_time - sum(qty)) as vacant, item.task_id
FROM order_items as item
LEFT JOIN tasks as t on t.task_id = item.task_id
LEFT JOIN menu as m on m.menu_id = t.menu_id
WHERE t.sequence = ${FIRST_SEQ} 
AND item.status = ${ITEM_STATUS_QUEUE}
AND item.task_id IN ($task_id)
GROUP BY queue_number, t.task_id, item.worker_id;`;