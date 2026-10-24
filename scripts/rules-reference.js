/* Original worked examples and paraphrases; Corebook references use printed pages.
 * RAW, module interpretations and the approved initiative house rule are labeled. */
const faq = "https://rtalsoriangames.com/wp-content/uploads/2021/07/RTG-CPR-CoreBookFAQv1.3.pdf";
const sections = [
  {
    id: "start", source: "RAW: Corebook 196-199, 209; FAQ v1.3, 8-9",
    en: {
      title: "Before you Jack In", summary: "Find a real access point and keep your body in range.",
      points: [
        "Bring Interface, a connected cyberdeck and interface plugs; Virtuality Goggles or an equivalent display preserve Meatspace awareness.",
        "Scanner costs a Meat Action; the GM decides which access points your Interface + 1d10 finds.",
        "Normally stay within 6 m of the access point without an intervening wall; Agents and CitiNet are not NET Architectures.",
      ],
      example: { label: "Access check", steps: ["Scanner: Interface 4 + die 5 = 9; the GM reveals a terminal.", "Approach to 4 m with no wall, then spend a NET Action on Jack In on a later turn."], result: "Scanner used the Meat Action, so this turn cannot also contain NET Actions." },
      links: [{ title: "Official FAQ: access points", url: faq + "#page=8" }],
    },
    ru: {
      title: "Перед подключением", summary: "Найдите настоящую точку доступа и оставайтесь рядом с ней.",
      points: [
        "Нужны Интерфейс, подключённая кибердека и интерфейсные разъёмы; очки виртуальности или аналог сохраняют восприятие реального мира.",
        "Scanner расходует мясное действие; ГМ определяет найденные точки по результату Интерфейс + 1d10.",
        "Обычно допустимы 6 м до точки без стены между вами; агенты и CitiNet не являются NET-архитектурами.",
      ],
      example: { label: "Проверка доступа", steps: ["Scanner: Интерфейс 4 + кубик 5 = 9; ГМ показывает терминал.", "Подойдите на 4 м без стены и потратьте NET-действие на Jack In в следующий ход."], result: "Scanner занял мясное действие: NET-действий в этом же ходу нет." },
      links: [{ title: "Официальный FAQ: точки доступа", url: faq + "#page=8" }],
    },
  },
  {
    id: "turn", source: "RAW: Corebook 197-198, 209-210; module turn counters",
    en: {
      title: "Your turn", summary: "Choose one Meat Action OR your NET Actions; you still get your Move Action.",
      diagram: `Turn (Interface 4)
  +-- Meat: 1 action
  |        OR
  +-- NET:  3 actions
      Jack In -> Backdoor -> Jack Out
Move Action: either choice`,
      points: [
        "NET movement and saving a File copy cost no NET Actions; visit each connected floor without skipping obstructions.",
        "To change branches, retrace their connections; one edge per UI click is not a one-floor-per-turn limit.",
        "Module: action counters refresh at the start of your turn; equipment can modify the allowance below.",
      ],
      example: { label: "Interface 4: three actions", steps: ["1: Jack In. 2: Backdoor a Password successfully.", "Move through accessible floors for free. 3: Jack Out safely."], result: "All 3 NET Actions spent; no Meat Action this turn." },
      table: { headers: ["Interface rank", "NET Actions / turn"], rows: [["1-3", "2"], ["4-6", "3"], ["7-9", "4"], ["10", "5"]] },
    },
    ru: {
      title: "Ваш ход", summary: "Одно мясное действие ИЛИ NET-действия; действие перемещения тела остаётся.",
      diagram: `Ход (Интерфейс 4)
  +-- Мясо: 1 действие
  |        ИЛИ
  +-- NET:  3 действия
      Jack In -> Backdoor -> Jack Out
Перемещение тела: в обоих случаях`,
      points: [
        "Сетевое перемещение и сохранение копии файла бесплатны: проходите связанные этажи по порядку, не минуя препятствия.",
        "Для смены ветви вернитесь по связям; один переход за клик не означает один этаж за ход.",
        "Модуль обновляет счётчики в начале вашего хода; оборудование может изменить приведённый ниже лимит.",
      ],
      example: { label: "Интерфейс 4: три действия", steps: ["1: Jack In. 2: успешный Backdoor пароля.", "Бесплатно пройдите доступные этажи. 3: безопасный Jack Out."], result: "Потрачены все 3 NET-действия; мясного действия в этом ходу нет." },
      table: { headers: ["Ранг Интерфейса", "NET-действий / ход"], rows: [["1-3", "2"], ["4-6", "3"], ["7-9", "4"], ["10", "5"]] },
    },
  },
  {
    id: "rolls", source: "RAW: Corebook 129-130, 198-201, 205; FAQ v1.3, 2; native CPR roll dialog",
    en: {
      title: "Checks, ties and LUCK", summary: "Fixed DV: total > DV; opposed check: the defender wins a tie.",
      diagram: `DV10: success needs >10
4 + 6     = 10 -> fail
4 + 6 + 1 = 11 -> pass
        ^
    1 LUCK, declared before rolling`,
      points: [
        "Interface abilities usually roll Interface + 1d10 with applicable modifiers; the native CPR critical d10 rules apply.",
        "A program never adds its owner's Interface to DEF, and Black ICE never adds it to ATK.",
        "Module: declare permitted LUCK before rolling in the standard dialog; spent points come from the Actor's LUCK pool.",
      ],
      example: { label: "DV10 boundary", steps: ["Interface 4 + die 6 = 10: failure against DV10.", "With 1 LUCK declared beforehand: 4 + 6 + 1 = 11."], result: "11 succeeds; 1 LUCK is spent, not added after seeing the roll." },
      table: { headers: ["NET combat", "Roll"], rows: [["Attacker program", "Interface + program ATK + 1d10"], ["Black ICE attack", "ICE ATK + 1d10"], ["Runner defense", "Interface + 1d10"], ["Program / ICE defense", "DEF + 1d10"]] },
      links: [{ title: "Official FAQ: Interface and LUCK", url: faq + "#page=2" }],
    },
    ru: {
      title: "Проверки, ничьи и УДАЧА", summary: "Фиксированная СЛ: итог > СЛ; встречная проверка: ничья за защитником.",
      diagram: `СЛ10: для успеха нужно >10
4 + 6     = 10 -> провал
4 + 6 + 1 = 11 -> успех
        ^
    1 УДАЧА, объявлена до броска`,
      points: [
        "Обычно способности используют Интерфейс + 1d10 с модификаторами; критические d10 обрабатывает штатная система CPR.",
        "Программа не добавляет Интерфейс владельца к DEF, а Black ICE не добавляет его к ATK.",
        "В модуле допустимую УДАЧУ объявляют до броска в стандартном диалоге; потраченные пункты списываются с Actor.",
      ],
      example: { label: "Граница СЛ10", steps: ["Интерфейс 4 + кубик 6 = 10: провал против СЛ10.", "С 1 УДАЧЕЙ, объявленной заранее: 4 + 6 + 1 = 11."], result: "11 даёт успех; 1 УДАЧА тратится заранее, не после просмотра броска." },
      table: { headers: ["Сетевой бой", "Бросок"], rows: [["Атакующая программа", "Интерфейс + ATK программы + 1d10"], ["Атака Black ICE", "ATK льда + 1d10"], ["Защита раннера", "Интерфейс + 1d10"], ["Защита программы / льда", "DEF + 1d10"]] },
      links: [{ title: "Официальный FAQ: Интерфейс и УДАЧА", url: faq + "#page=2" }],
    },
  },
  {
    id: "jack", source: "RAW: Corebook 198; FAQ v1.3, 8; equipment-specific exceptions apply",
    en: {
      title: "Jack In / Jack Out", summary: "Budget 1 NET Action to enter and 1 to leave safely.",
      points: [
        "Leaving range or going behind a wall disconnects you unsafely, subject to specific equipment exceptions.",
        "Unsafe exit applies the effects of ALL encountered enemy Black ICE not Derezzed, including ICE escaped with Slide.",
        "FAQ: defenses normally reset when all runners leave; an enemy administrator at the bottom can be an exception.",
      ],
      example: { label: "Slide is not safe disconnection", steps: ["You encountered 2 ICE: one Derezzed, one escaped with Slide.", "Walk out of range instead of spending 1 NET Action on Jack Out."], result: "The remaining ICE applies its effect; Slide did not erase that encounter." },
      links: [{ title: "Official FAQ: multiple runners and reset", url: faq + "#page=8" }],
    },
    ru: {
      title: "Jack In / Jack Out", summary: "Заложите 1 NET-действие на вход и 1 на безопасный выход.",
      points: [
        "Выход за дальность или за стену небезопасно обрывает связь, если конкретное оборудование не даёт исключения.",
        "При обрыве применяются эффекты ВСЕХ встреченных вражеских ICE, не доведённых до Derezzed, включая оставленных через Slide.",
        "FAQ: защиты обычно сбрасываются после выхода всех раннеров; вражеский администратор на дне может быть исключением.",
      ],
      example: { label: "Slide не заменяет отключение", steps: ["Встречены 2 ICE: один Derezzed, от второго вы ушли через Slide.", "Вы выйдете за дальность вместо траты 1 NET-действия на Jack Out."], result: "Оставшийся ICE применит эффект: Slide не отменяет факт встречи." },
      links: [{ title: "Официальный FAQ: несколько раннеров и сброс", url: faq + "#page=8" }],
    },
  },
  {
    id: "abilities", source: "RAW: Corebook 198-200, 212",
    en: {
      title: "Passwords, Files and Control", summary: "Backdoor opens a route; Eye-Dee identifies data; Control operates devices.",
      points: [
        "Backdoor must beat the Password DV; knowing the password lets you pass without that check.",
        "Eye-Dee costs 1 NET Action and must beat a File's DV when present; saving the copy is free.",
        "Taking Control and operating a device cost separate NET Actions; each node activates once per turn, from any floor while held.",
      ],
      example: { label: "Taking a camera node", steps: ["Node DV8: Interface 4 + die 5 = 9 takes Control for 1 NET Action.", "Spend another NET Action to operate it; a rival now needs >9 to take it away."], result: "2 NET Actions used; this node cannot activate again this turn." },
    },
    ru: {
      title: "Пароли, файлы и Control", summary: "Backdoor открывает путь, Eye-Dee определяет данные, Control управляет устройствами.",
      points: [
        "Backdoor должен превысить СЛ пароля; известный пароль позволяет пройти без этой проверки.",
        "Eye-Dee стоит 1 NET-действие и при наличии СЛ файла должен её превысить; сохранение копии бесплатно.",
        "Захват Control и использование устройства стоят отдельных NET-действий; каждый узел активируется раз за ход с любого этажа, пока удерживается.",
      ],
      example: { label: "Захват узла камер", steps: ["СЛ узла 8: Интерфейс 4 + кубик 5 = 9 захватывает Control за 1 NET-действие.", "Ещё одно NET-действие управляет устройством; сопернику для перехвата теперь нужно >9."], result: "Потрачены 2 NET-действия; повторно активировать этот узел в этом ходу нельзя." },
    },
  },
  {
    id: "map", source: "RAW: Corebook 199-200, 209-210; module interpretation: branch-distance algorithm",
    en: {
      title: "Pathfinder, branches and Slide", summary: "Scout before advancing; walking past ICE does not end its pursuit.",
      diagram: `1 -> 2 --+-- A -> A2
        |
        +-- B
Return: A2 -> A -> 2 -> B`,
      points: [
        "Pathfinder costs 1 NET Action, reveals floor contents but not DVs, and stops at an obstruction whose DV is higher than the check.",
        "Slide: Interface + 1d10 vs. one non-Demon ICE's PER + 1d10, once per turn, moving to a legal adjacent floor on success.",
        "Module interpretation, not a RAW graph algorithm: Pathfinder counts child-edge distance and blocked subtrees, including a Password on your current floor.",
      ],
      example: { label: "Equal DV does not block the scan", steps: ["Pathfinder: Interface 4 + die 6 = 10.", "Within its range, a DV10 Password does not stop the scan; a DV11 Password reveals its floor but hides what follows."], result: "The scan neither unlocks a Password nor reveals its DV to the runner." },
      links: [{ title: "Reddit discussion, not RAW: movement and pursuit", url: "https://www.reddit.com/r/cyberpunkred/comments/ye07cx" }],
    },
    ru: {
      title: "Pathfinder, ветви и Slide", summary: "Разведайте путь заранее: обычный уход с этажа не прекращает погоню ICE.",
      diagram: `1 -> 2 --+-- A -> A2
        |
        +-- B
Возврат: A2 -> A -> 2 -> B`,
      points: [
        "Pathfinder стоит 1 NET-действие, показывает содержимое этажей без СЛ и останавливается на препятствии со СЛ выше результата.",
        "Slide: Интерфейс + 1d10 против PER + 1d10 одного ICE, кроме Демона, раз за ход с переходом на допустимый соседний этаж при успехе.",
        "Решение модуля, не RAW-алгоритм графа: Pathfinder считает дочерние связи и блокирует поддеревья, учитывая пароль текущего этажа.",
      ],
      example: { label: "Равная СЛ не мешает сканированию", steps: ["Pathfinder: Интерфейс 4 + кубик 6 = 10.", "В пределах дальности пароль СЛ10 не мешает обзору; пароль СЛ11 показывает свой этаж, но скрывает продолжение."], result: "Сканирование не открывает пароль и не сообщает раннеру его СЛ." },
      links: [{ title: "Обсуждение Reddit, не RAW: движение и погоня", url: "https://www.reddit.com/r/cyberpunkred/comments/ye07cx" }],
    },
  },
  {
    id: "traces", source: "RAW: Corebook 199-200, 210; example DV/action budget chosen by the GM",
    en: {
      title: "Virus and Cloak", summary: "Reach the bottom of the longest branch for lasting changes.",
      points: [
        "Virus: agree up to 2 reasonable changes with the GM, who sets the DV and required NET Actions, possibly across turns.",
        "After spending those actions, beat the DV; your successful Virus total becomes its removal DV.",
        "Cloak costs 1 NET Action and sets the Pathfinder DV to discover your traces and Virus; it does not hide you from an active Demon.",
      ],
      example: { label: "A GM-approved camera glitch", steps: ["At the longest branch's bottom, the GM sets DV8 and 4 NET Actions: spend 3 now and 1 next turn.", "Virus: Interface 4 + die 5 = 9 succeeds; later Cloak 12 hides its traces."], result: "An investigator needs Pathfinder >12 to find it, then a removal check >9." },
    },
    ru: {
      title: "Virus и Cloak", summary: "Для постоянного изменения нужно дно самой длинной ветви.",
      points: [
        "Virus: согласуйте до 2 разумных изменений с ГМом, который назначит СЛ и число NET-действий, при необходимости на несколько ходов.",
        "После траты этих действий превысьте СЛ; успешный итог Virus становится СЛ его удаления.",
        "Cloak стоит 1 NET-действие и задаёт СЛ Pathfinder для обнаружения следов и вируса, но не скрывает вас от активного Демона.",
      ],
      example: { label: "Сбой камер, согласованный с ГМом", steps: ["На дне длиннейшей ветви ГМ назначил СЛ8 и 4 NET-действия: потратьте 3 сейчас и 1 в следующий ход.", "Virus: Интерфейс 4 + кубик 5 = 9 даёт успех; позднее Cloak 12 скрывает следы."], result: "Исследователю нужен Pathfinder >12 для обнаружения, затем проверка удаления >9." },
    },
  },
  {
    id: "programs", source: "RAW: Corebook 201-204; Corebook Errata v1.25, correction to 201",
    en: {
      title: "Copies, REZ and destruction", summary: "Track each installed copy, not one activation for the whole deck.",
      points: [
        "Each copy activates once per Meatspace round; an Attacker activates with its attack and automatically deactivates after use, even on a miss.",
        "An active copy at 0 REZ is Derezzed, not Destroyed without an explicit effect; recovery costs deactivate + activate, respecting activation limits.",
        "Only one same-name Defender runs at once; each Defender copy and each Superglue copy is usable once per netrun.",
      ],
      example: { label: "Two Swords, three NET Actions", steps: ["Action 1: attack with Sword A. Action 2: attack with Sword B.", "Action 3 cannot reuse A or B this round; Zap is an alternative attack."], result: "Both Swords can activate next round; an already-used Defender copy cannot be refreshed this way." },
      links: [{ title: "Reddit discussion, not RAW: copy limits and auto-deactivation", url: "https://www.reddit.com/r/cyberpunkred/comments/ulrulm" }],
    },
    ru: {
      title: "Копии, REZ и уничтожение", summary: "Учитывайте каждую установленную копию, а не одну активацию на всю деку.",
      points: [
        "Каждая копия активируется раз за мясной раунд; Attacker включается вместе с атакой и автоматически выключается после неё, даже при промахе.",
        "Активная копия с 0 REZ получает Derezzed, а не Destroyed без особого эффекта; восстановление требует выключения и включения с учётом лимитов активации.",
        "Одновременно работает один Defender каждого названия; каждая копия Defender и каждая копия Superglue используется раз за забег.",
      ],
      example: { label: "Два Sword, три NET-действия", steps: ["Действие 1: атака Sword A. Действие 2: атака Sword B.", "Действие 3 не позволяет повторно использовать A или B в этом раунде; можно атаковать через Zap."], result: "В следующем раунде оба Sword снова доступны; использованная копия Defender так не обновляется." },
      links: [{ title: "Обсуждение Reddit, не RAW: лимиты копий и автовыключение", url: "https://www.reddit.com/r/cyberpunkred/comments/ulrulm" }],
    },
  },
  {
    id: "ice", source: "RAW: Corebook 200-201, 205; FAQ v1.3, 9; queue exception in Demons section",
    en: {
      title: "Black ICE: ambush or deployment", summary: "An encountered ambush and deliberate combat deployment are different.",
      diagram: `SPEED 10:10 -> no ambush effect
                 |
                 v
Queue (house rule), newest first:
  ICE B 18
  ICE A 18
  Runner 18`,
      points: [
        "Ambush: runner Interface + SPEED bonuses + 1d10 vs. ICE SPD + 1d10; only a higher ICE total applies its immediate effect.",
        "Anti-program ICE attacks a random active program, not an empty deck, but follows the runner as a program source until Derezzed or escaped with Slide.",
        "Deploy on your floor as a trap only outside combat, or against a valid combat target without an ambush SPEED attack; retargeting costs deactivate + activate.",
      ],
      example: { label: "Ambush tie, then a normal attack", steps: ["Runner: Interface 4 + SPEED bonus 2 + die 4 = 10; ICE SPD 6 + die 4 = 10.", "No immediate effect; later ICE ATK 6 + die 5 = 11 beats runner Interface 4 + die 6 = 10."], result: "The normal attack hits without owner Interface; the ICE enters the top of the queue even when its ambush fails." },
      links: [{ title: "Official FAQ: anti-program ambush triggers", url: faq + "#page=9" }],
    },
    ru: {
      title: "Black ICE: засада или развёртывание", summary: "Встреча с засадой и развёртывание льда в бою работают по-разному.",
      diagram: `SPEED 10:10 -> нет эффекта засады
                 |
                 v
Очередь (домашнее), новый первым:
  ICE B 18
  ICE A 18
  Раннер 18`,
      points: [
        "Засада: Интерфейс + бонусы SPEED + 1d10 раннера против SPD + 1d10 льда; немедленный эффект возникает только при большем итоге льда.",
        "Антипрограммный лёд атакует случайную активную программу, не пустую деку, но преследует раннера как источник программ до Derezzed или успешного Slide.",
        "Засаду на своём этаже ставят только вне боя; в бою выбирают допустимую цель без атаки SPEED, а смена цели требует выключения и включения.",
      ],
      example: { label: "Ничья засады, затем обычная атака", steps: ["Раннер: Интерфейс 4 + бонус SPEED 2 + кубик 4 = 10; лёд: SPD 6 + кубик 4 = 10.", "Немедленного эффекта нет; позднее ATK льда 6 + кубик 5 = 11 побеждает Интерфейс раннера 4 + кубик 6 = 10."], result: "Обычная атака попала без Интерфейса владельца; лёд встаёт наверх очереди даже при неудачной засаде." },
      links: [{ title: "Официальный FAQ: срабатывание антипрограммных засад", url: faq + "#page=9" }],
    },
  },
  {
    id: "demons", source: "RAW: Corebook 205, 212; initiative: explicitly approved world house rule",
    en: {
      title: "Demons and the queue exception", summary: "Demons operate Control Nodes and Zap; they are not program-running decks.",
      points: [
        "Demon NET defense and Zap use Interface + 1d10; Combat Number + 1d10 is for controlled physical devices.",
        "Demons know their Architecture, cannot be Slid, and do not get the ordinary ICE discovery hit.",
        "House rule: new top-queue ICE takes the highest initiative's SAME number and sorts ahead, newest first; RAW instead says +1.",
      ],
      example: { label: "Highest initiative is 18", steps: ["An ICE enters: ICE 18, runner 18, guard 12.", "A second ICE enters: new ICE 18, first ICE 18, runner 18, guard 12."], result: "The order changes; no ICE gets 19 or 20 under this house rule." },
    },
    ru: {
      title: "Демоны и исключение очереди", summary: "Демоны управляют Control Node и используют Zap; деки с программами у них нет.",
      points: [
        "Сетевая защита и Zap Демона используют Интерфейс + 1d10; Combat Number + 1d10 относится к управляемым физическим устройствам.",
        "Демоны знают свою архитектуру, от них нельзя уйти через Slide, и обычного первого удара льда при обнаружении у них нет.",
        "Домашнее правило: новый верхний ICE получает ТО ЖЕ число инициативы, что лидер, но стоит выше, новый первым; RAW вместо этого даёт +1.",
      ],
      example: { label: "Наибольшая инициатива 18", steps: ["Входит ICE: лёд 18, раннер 18, охранник 12.", "Входит второй: новый лёд 18, первый лёд 18, раннер 18, охранник 12."], result: "Меняется порядок; по этому домашнему правилу лёд не получает 19 или 20." },
    },
  },
  {
    id: "gear", source: "RAW: Corebook 201, 203-204, 208; Corebook Errata 3; module equipment selection; community links are not RAW",
    en: {
      title: "Gear and source boundaries", summary: "Use the active deck's gear and the actual program effect.",
      points: [
        "Use the active deck's hardware and slot restrictions; FBC Integrated Bodyweight Coating shares a separate hardware pool across cyberware-integrated decks.",
        "Brain damage bypasses worn and implanted armor; applicable NET protection such as Armor still reduces it.",
        "Community interpretations and Going Quiet are not core RAW; module GM restore/HP/REZ controls are administrative tools, not free NET Actions.",
      ],
      example: { label: "Protection that actually applies", steps: ["A brain-damage effect rolls 9; the runner wears SP11 armor.", "An active Armor program reduces that damage by 4: 9 - 4 = 5."], result: "Lose 5 HP; do not subtract SP11 again." },
      links: [{ title: "Community Downlink: unofficial resource hub", url: "https://publish.obsidian.md/community-downlink/Home" }, { title: "Community question index: answers require verification", url: "https://publish.obsidian.md/community-downlink/FAQs/Discord/General" }],
    },
    ru: {
      title: "Оборудование и границы источников", summary: "Учитывайте действующую деку и точный эффект программы.",
      points: [
        "Учитывайте оборудование и ограничения используемой деки; FBC Integrated Bodyweight Coating разделяет отдельный пул оборудования между встроенными деками.",
        "Урон мозгу обходит носимую и имплантированную броню; подходящая сетевая защита, например Armor, продолжает его снижать.",
        "Толкования сообщества и Going Quiet не являются базовым RAW; кнопки восстановления, ОЗ и REZ у ГМа служат администрированию, не бесплатным NET-действиям.",
      ],
      example: { label: "Какая защита работает", steps: ["Эффект наносит 9 урона мозгу; на раннере броня SP11.", "Активная программа Armor уменьшает урон на 4: 9 - 4 = 5."], result: "Потеряйте 5 ОЗ; SP11 повторно не вычитается." },
      links: [{ title: "Community Downlink: неофициальные материалы", url: "https://publish.obsidian.md/community-downlink/Home" }, { title: "Вопросы сообщества: ответы требуют проверки", url: "https://publish.obsidian.md/community-downlink/FAQs/Discord/General" }],
    },
  },
];

export function rulesReference(language = "en") {
  const locale = language === "ru" ? "ru" : "en";
  return sections.map(({ id, source, ...translations }) => {
    const content = translations[locale];
    // One derived paragraph for legacy search consumers; compact views use the fields above.
    const body = [
      content.summary, ...content.points, content.example.label, ...content.example.steps,
      content.example.result, ...(content.table?.headers ?? []), ...(content.table?.rows.flat() ?? []),
    ].join(" ");
    return { id, ...content, body: [body], source };
  });
}
