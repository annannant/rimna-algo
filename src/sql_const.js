export const SELECT_MENU_MAIN_TASKS = `SELECT m.*, t.task_id, t.type as task_type, t.cooking_time, t.menu_id, t.work_station_id, t.sequence
FROM tasks as t 
LEFT JOIN menu as m ON t.menu_id = m.menu_id 
where m.menu_id in ($menu_id)
AND t.sequence = 1`;
// order by cooking_time asc, t.menu_id asc, t.sequence asc

export const SELECT_MENU_SUB_TASKS = `SELECT m.*, m.name as menu_name, t.task_id, t.type as task_type, t.cooking_time, t.menu_id, t.work_station_id, t.sequence
FROM menu as m
LEFT JOIN tasks as t ON t.menu_id = m.menu_id 
where m.menu_id in ($v)
AND t.sequence > 1
order by cooking_time asc, t.menu_id asc, t.sequence asc`

// export const order items
export const INSERT_ORDER_ITEMS = `INSERT INTO rimna_db.order_items 
(queue_number, qty, status, expected_start_at, expected_end_at, user_id, order_id, task_id) VALUES 
('$queue_number', '$qty', '$status', '$expected_start_at', '$expected_end_at', '$user_id', '$order_id', '$task_id');`;

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
item.*, t.work_station_id, w.name, w.qty, t.type, m.name
from order_items as item
LEFT JOIN tasks as t on t.task_id = item.task_id
LEFT JOIN menu as m on m.menu_id = t.menu_id
LEFT JOIN work_stations as w on w.work_station_id = t.work_station_id 
WHERE t.work_station_id = $work_station_id 
AND (expected_end_at > '$expected_end_at')
ORDER BY expected_end_at ASC`

export const SELECT_ITEM_IN_QUEUE = `SELECT item.*, m.name as menu_name, t.*, t.type as task_type, item.order_item_id as ref_id  
from order_items as item
LEFT JOIN tasks as t on t.task_id = item.task_id
LEFT JOIN menu as m on m.menu_id = t.menu_id
WHERE  item.status = 'queue'`;


export const SELECT_ITEM_GROUP_BY_MAIN = `SELECT 
g.*, item.*, t.*, t.type as task_type, m.name as menu_name, 
item.order_item_id as ref_id
FROM order_item_group as g
LEFT JOIN order_items as item on item.order_item_id = g.sub_order_item_id
LEFT JOIN tasks as t on t.task_id = item.task_id
LEFT JOIN menu as m on m.menu_id = t.menu_id
WHERE main_order_item_id IN ($main_order_item_id)
`;

export const SELECT_EXTRA_MENU_BY_MAIN_MENU = `SELECT e.*, m.*, m.name as menu_name, 
(SELECT sum(qty) from extra_menu_items WHERE menu_id = e.extra_menu_id
AND DATE(created_at) = DATE('$created_at')) as remaining,

from menu_with_extra as e
LEFT JOIN menu as m on m.menu_id = e.extra_menu_id
WHERE e.main_menu_id IN ($main_menu_id)
`