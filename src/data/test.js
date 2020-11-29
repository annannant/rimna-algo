


items = [
  { menu_id: 14, qty: 1, },
  { menu_id: 16, qty: 2, }, 
]

function Calculate(items)
  OrderDate = now

  OrderItems = GetExistingOrderItemInQueue()

  ExtraTaskItems = GetExtraTask(items)

  items = items.Merge(ExtraTaskItems) // รวม extra task และเมนูเข้าด้วยกัน

  Tasks = GetMenuInfoMainTask(items); 

  Tasks = GroupWithOrderInQueue(Tasks); 

  Tasks = SplitFromMaxCookingWithSameTime(Tasks)

  RefId = 1;
  for (i = 0; i < Tasks.length; i++) {
    Task = ข้อมูล Task ในแต่ละรอบ

    if (Task สามารถทำพร้อมกับรายการที่อยู่ในคิิว (is_group_in_queue = True)) {
      OrderItems.insert(Task);
      CONTINUE;
    }    

    NeedStartTime = OrderDate;

    WorkStationId = work station id ของ Task นี้
    TastStartTime = GetStartTimeByCheckAvailableStation(WorkStationId, NeedStartTime);

    Chief = SelectChief(Task, TastStartTime, OrderItems);

    CanDoWithParallelItem = Has Chief.parallel_parent_id 
    if (CanDoWithParallelItem == true) {
      for (j = 0; j < OrderItems.length; j++) {
        OrderItem = OrderItems[j];
        if (OrderItem.ref_id == Chief.parallel_parent_id) {
          TaskInfo = {
            ref_id: RefId,
            expected_start_at: Chief.start,
            expected_end_at: Chief.end,
            menu_id: Task.menu_id,
            qty: Task.qty,
            worker_id: OrderItem.worker_id,
            task_type: Task.task_type,
            parallel_type: Task.parallel_type,
            is_extra_menu: Task.is_extra_menu,
          }
          OrderItems[j].children.insert(TaskInfo);
          RefId++;
        }
      }
    } else {
      // ADD MAIN TASK
      StartTime = Chief.start;
      EndTime = Chief.end;
      TaskInfo = {
        ref_id: refId,
        expected_start_at: StartTime,
        expected_end_at: EndTime,
        menu_id: Task.menu_id,
        qty: Task.qty,
        worker_id: Chief.worker_id,
        task_type: Task.task_type,
        parallel_type: Task.parallel_type,
        is_extra_menu: Task.is_extra_menu,
      };
      OrderItems.insert(TaskInfo);
      RefId++;

      // ADD SUB TASK
      // เช่น จัดจานเฟรนฟราย, จัดจานไก่ทอด
      SubTasks = (a) รายการข้อมูล task ของเมนูนี้ที่มี sequence > 1;
      LatestTime = EndTime;
      for (s = 0; s < SubTasks.length; s++) {
        SubTask = SubTasks[s]
        SubTaskStartTime = LatestTime + 1 minutes
        SubTaskEndTime = SubTaskStartTime + SubTask.cooking_time
        TaskInfo = {
          ref_id: RefId,
          expected_start_at: SubTaskStartTime,
          expected_end_at: SubTaskEndTime,
          menu_id: SubTask.menu_id,
          qty: Task.qty,
          worker_id: Chief.worker_id,
          task_type: SubTask.task_type,
          parallel_type: SubTask.parallel_type,
          is_extra_menu: SubTask.is_extra_menu,
        };
        LatestTime = SubTaskEndTime;
        OrderItems.insert(TaskInfo);
        RefId++;   
      }
    }
  }

  LatestQueue = ดึง queu number ล่าสุดของวันนั้น;
  Queue = LatestQueue;
  for (i = 0; i < OrderItems.length; i++) {
    OrderItem = OrderItems[i]
    if (OrderItem มี queue_number อยู่แล้ว) {
      continue;
    }
    OrderItems[i].queue_number = Queue;
    Queue++;
  }

  // insert to db


  a) table tasks
  - menu_id = menu_id
  - sequence > 1


function SelectChief(Task, TastStartTime, OrderItems)
  VacantList = Initialize an empty array
  Chiefs = (a) จำนวนของแม่ครัวที่มาทำงานทั้งหมด;

  for (i = 0; i < Chiefs.length; i++) {
    Chief = chiefs[i];

    ChiefTasks = (b) จำนวนที่แม่ครัวคนนี้ทำอยู่;
    if (ChiefTasks.length == 0) {
      return {
        worker_id: Chief.worker_id,
        start: TastStartTime,
      };
    }

    for (j = 0; j < ChiefTasks.length; j++) {
      ChiefTask = ChiefTasks[j];
      StartTask = เวลา start ที่ต้องเริ่มทำอาหารของ task นี้
      EndTask = เวลา end ที่ทำอาหารเสร็จของ task นี้

      if (ChiefTask == (c) PARALLEL_TYPE_MAIN && Task == (d) PARALLEL_TYPE_PARALLEL) {

        ChildrenTasks = Task ที่ทำพร้อมกันอยู่กับ ChiefTask นี้
        if (ChildrenTasks > 0) {

          for (c = 0; c < ChildrenTasks.length; c++) {
            ChildrenTask = ChildrenTasks[c];

            ChildrenTaskEnd = เวลา end ที่ทำอาหารเสร็จของ ChildrenTask นี้
            if (ChildrenTaskEnd < TastStartTime) {
              ChildrenTaskEnd = TastStartTime
            }

            // 
            LastChildrenTask = เป็น children task สุดท้าย
            if (LastChildrenTask == true) {

              Durations = EndTask - ChildrenTaskEnd

              VacantList.insert({
                parallel_parent_id: ChiefTask.ref_id,
                plus_time: (e),
                worker_id: Chief.worker_id,
                start: ChildrenTaskEnd,
                duration: Durations,
              }) 
            }
          }
        } else {

          if (StartTask < TastStartTime) {
            StartTask = TastStartTime
          }

          Durations = EndTask - StartTask;
          if (Durations > 1) {
            VacantList.insert({
              parallel_parent_id: ChiefTask.ref_id,
              plus_time: (e),
              worker_id: Chief.worker_id,
              start: StartTask,
              duration: 10000,
            });
          }
        }
      } else {

        if (EndTask < TastStartTime) {
          EndTask = TastStartTime
        }

        NoNextTask = ไม่มี Task ถัดไป
        if (NoNextTask == true) {
          VacantList.insert({
            worker_id: Chief.worker_id,
            plus_time: 0,
            start: EndTask,
            duration: 100000,
          });
          continue;
        }

        NextTask = ChiefTasks[j + 1]
        NextTaskStartTime = เวลา start ที่ต้องเริ่มทำอาหารของ NextTask
        Durations = NextTaskStartTime - EndTask;
        if (Durations > 1) {
          VacantList.push({
            worker_id: Chief.worker_id,
            plus_time: 0,
            start: EndTask,
            duration: Durations,
          });
        }

      }
    }
  }


  for (e = 0; e < VacantList.length; e++) {
    Vacant = VacantList[e]
    if (Vacant.duration < (Task.cooking_time + Vacant.plus_time) ) {
      DELETE Vacant
      continue;
    }
    Vacant.cooking_time = Task.cooking_time
    Vacant.end = Vacant.start + Vacant.cooking_time
  }

  VacantList = เรียงตามเวลาที่เสร็จเร็วสุด, และเวลา extra plus time ที่น้อยที่สุด
  SelectedVacant = VacantList[0]
  return SelectedVacant

  a) table workers
    - worker_type = chief
    - work_status = present

  b) OrderItems
    - filter with worker_id

  c) Task นี้มี parallel_type เป็น main ที่สามารถมี task อื่นมาทำพร้อมกันได้
    - เช่น task ทอดเฟรนฟราย หรือ task ย่างหมูย่าง
    
  d) Task นี้มี parallel_type เป็น parallel ที่สามารถทำพร้อมกันกับ task main ได้

  e) Configuration plus extra time เวลาบวกเพิ่ม กรณีที่ในพร้อมกับ extra task (parallel_type = main)






function GetStartTimeByCheckAvailableStation(WorkStationId, StartTime) 
  if WorkStationId == NULL
    return StartTime + 1 Minutes

  TotalUsed = a
  TotalWorkStationQty = b
  if (TotalUsed < TotalWorkStationQty) {
    return StartTime + 1 Minutes
  }
  
  return c + 1 Minutes

  a) จำนวน work station ที่มีการใช้งานในเวลาที่จะเริ่มใช้ StartTime
    - table order_items, tasks, menu
    - work_station_id = WorkStationId
    - expected_end_at > StartTime

  b) จำนวน work station ที่มีของ work station นั้น

  c) เวลาที่ work station เสร็จเร็วที่สุด


function splitFromMaxCooking(items)
  Result = Initialize an empty array 
  // split
  for (j = 0; j < items.length; j++) {
    item = items[j];
    if (item.qty > item.max_cooking_same_time) {
      round = ceil(item.qty / item.max_cooking_same_time);
      qty = item.qty;
      for (k = 0; k < round; k++) {
        q = qty > item.max_cooking_same_time ? item.max_cooking_same_time : qty;
        
        Result.insert(a);
        qty -= item.max_cooking_same_time;
      }
    } else {
      Result.insert(b);
    }
  }

  return Result;

  a ) ข้อมูล task โดยจำนวน (qty) เป็นจำนวนที่แบ่งแล้ว

  b ) ข้อมูล task โดยจำนวน (qty) เป็นจำนวนเดิม





function GroupWithOrderInQueue(tasks)
  Result = Initialize an empty array 

  for (i = 0; i < tasks.length; i++) {
    Vacants = (a) ค้นหารายการอาหารที่อยู่ในคิว ที่เมนูนี้สามารถทำพร้อมกันได้
    // ไม่มี capacity เหลือ
    if (Vacants.length == 0) {
      Result.insert(b)
      continue;
    }

    RemainQty = จำนวนที่ task นี้ต้องทำ;
    for (j = 0; j < Vacants.length; j++) {
      Task
      if (remainQty == 0) {
        continue;
      }

      Used = จำนวนที่ทำได้;
      Vacant = จำนวน capacity ที่ว่าง
      if (Vacant - remainQty > 0) {
        Used = remainQty;
      } else {
        Used = Vacant;
      }

      Result.insert(c)
      RemainQty -= used;
    }

    if (remainQty > 0) {
      Result.insert(d);
    }
  }

  return Result

  a ) ค้นหารายการอาหารที่อยู่ในคิว ที่มี capacity เหลือ ที่เมนูนั้นสามารถทำพร้อมได้
    - table order_items, tasks, menu
    - sequence = 1
    - status = queue
    - task_id = task ของเมนูนั้น

  b) Task 
  
  c) Task และเพ่ิม key เป็นการ falg ค่า ว่าสามารถทำพร้อมรายการอื่นได้
    - is_group_in_queue = true
    - queue_number = queue_number ที่ทำพร้อมกัน  
    - qty = จำนวนที่ทำได้

  d) หลักจากมีการแบ่งจำนวนไปทำพร้อมกับรายการอื่น หากจำนวนที่ต้องทำ
    เหลือมากกว่า 0 ให้เพิ่มเข้า Result Array และ set qty = จำนวนคงเหลือที่ต้องทำ
    - qty = จำนวนที่เหลือ ที่ต้องทำ











function GetMenuInfoMainTask(items) 
  Result = (a) ข้อมูล tasks และ menu ของ input items
  
  Result = (b) เรียงลำดับ tasks

  return Result

  a) รายการ task ของรายการอาหาร (เฉพาะ task หลักที่ทำลำดับแรก)
    - table tasks and menu
    - task sequence = 1

  b) เรียงลำดับ tasks ที่เป็นทอดหรือย่างขึ้นมาก่อน taks อื่น ๆ 
    - ภายใน task ทอดหรือย่าง เรียงลำดับเวลาในการทำ cooking_time น้อยไปมาก


function GetExtraTask(items)
  ExtraTasks = Initialize an empty array 

  CloseTime = a
  if (CloseTime == true) {
    return ExtraTasks;
  }

  for (i = 0; i < items.length; i++) {
    ExtraMenuItems = (b) รายการ extra menu ของอาหารนี้
    if (ExtraMenuItems.length == 0) {
      continue;
    }

    for (j = 0; j < ExtraMenuItems.length; j++) {
      ExtraMenuInfo = ข้อมูลเมนูของ extra menu นี้
      NoReorderPoint = extra menu นี้ ไม่มีจุด reorder point  
      if (NoReorderPoint == true) 
        continue
      }

      TotalRemain = (c) จำนวนคงเหลือของ extra menu 
      ReorderPoint = จุด reorder point ของ extra menu นี้
      if (TotalRemain <= ReorderPoint) {
        ExtraTasks.insert(d)    
      }
    }
  }

  return ExtraTasks


  a) ตรวจสอบว่า เป็นก่อนเวลาปิดร้าน 2 ชั่วโมง หรือไม่
     - now > เวลาร้านปิด 2 ชม.
  
  b) รายการ extra menu ของเมนูอาหารนั้น
    - table main_menu_with_extra_menu
    - main_menu_id = menu_id ของอาหารนั้น
 
  c) จำนวนที่แม่ครัวทำ + (-จำนวนที่ใช้ไปในแต่ละ order) + (จำนวนที่กำลังทำอยู่ + จำนวนที่กำลังทำแล้ว)

  d) ข้อมูล extra menu และจำนวนสั่งทำเริ่มต้น default_reorder_qty



function GetExistingOrderItemInQueue()
  OrderItems = a

  for (i = 0; i < OrderItems.length; i++) {
    OrderItems[i].children = b(OrderItems[i].order_item_id)
  }

  return OrderItems

  a) รายการ order_items ที่มี parallel_type เป็น main ที่อยู่ในคิวทั้งหมด
    - parallel_type = main
    - status = queue

  b) รายการ order_items ทำที่พร้อมกับ order_item_id นี้
    - parallel_parent_id = order_item_id
