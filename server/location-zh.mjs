// Source names stay canonical for matching; these display names follow the Chinese Pokémon location list.
const names={
  'Abundant Shrine':'丰饶之祠','Celestial Tower':'天堂之塔',"Challenger's Cave":'修行岩屋','Chargestone Cave':'电气石洞穴',
  'Cold Storage':'冷冻仓库','Desert Resort':'荒野名胜区','Dragonspiral Tower':'龙螺旋之塔','Dreamyard':'梦的遗址',
  'Driftveil City':'帆巴市','Driftveil Drawbridge':'帆巴吊桥','Giant Chasm':'巨人洞窟','Guidance Chamber':'引导之室',
  'Icirrus City':'雪花市','Lostlorn Forest':'迷幻森林','Marvelous Bridge':'奇幻桥','Mistralton Cave':'吹寄洞穴',
  'Moor Of Icirrus':'雪花湿地','P2 Laboratory':'P2实验室','Pinwheel Forest':'矢车森林','Striaton City':'三曜市',
  'Twist Mountain':'罗斯山','Undella Bay':'涟漪湾','Undella Town':'涟漪镇','Victory Road':'冠军之路',
  'Village Bridge':'村庄桥','Wellspring Cave':'泉源洞穴','Route 209':'209号道路',
  'Granite Cave':'石之洞窟','Viridian Forest':'常青森林','Team Rocket HQ':'火箭队基地',
  'Mt. Moon':'月见山','Mt. Pyre':'送神山','Cerulean Cave':'华蓝洞窟','Power Plant':'无人发电厂',
  'Rock Tunnel':'岩山隧道','Pokemon Mansion':'宝可梦屋','Petalburg Woods':'橙华森林',
  'Berry Forest':'树果森林','Bond Bridge':'牵绊桥','Canyon Entrance':'溪谷入口','Cape Brink':'边缘海岬',
  'Five Isle Meadow':'第5岛空地','Icefall Cave':'冻瀑洞窟','Kindle Road':'热气之路','Lost Cave':'不归之穴',
  'Memorial Pillar':'回忆之塔','Mt. Ember':'灯火山','Outcast Island':'外岛','Pattern Bush':'标志之林',
  'Ruin Valley':'遗迹山谷','Seafoam Islands':'双子岛','Sevault Canyon':'七宝溪谷',
  'Treasure Beach':'宝物海滩','Water Labyrinth':'水之迷宫','Water Path':'水之步道',
  'Bellchime Trail':'铃音小道','Burned Tower':'烧焦塔','Cliff Edge Gate':'断崖入口','Dark Cave':'黑暗洞穴',
  "Dragon's Den":'龙穴','Ice Path':'冰雪小径','Ilex Forest':'栎树林','Lake of Rage':'愤怒之湖',
  'Mt. Mortar':'擂钵山','National Park':'自然公园','Ruins of Alph':'阿露福遗迹',
  'Tohjo Falls':'都城瀑布','Union Cave':'互连洞','Whirl Islands':'漩涡岛',
  'Abandoned Ship':'弃船','Ever Grande City':'彩悠市','Jagged Pass':'凹凸山道','Meteor Falls':'流星瀑布',
  'New Mauville':'新紫堇','Rusturf Tunnel':'卡绿隧道','Shoal Cave':'浅滩洞穴','Sky Pillar':'天空之柱',
  'Acuity Lakefront':'睿智湖畔','Eterna Forest':'百代森林','Floaroma Meadow':'花苑花田',
  'Fuego Ironworks':'多多罗钢铁厂','Iron Island':'钢铁岛','Lake Acuity':'睿智湖','Lake Valor':'立志湖',
  'Lake Verity':'心齐湖','Lost Tower':'迷失塔','Mt. Coronet':'天冠山','Old Chateau':'森之洋馆',
  'Oreburgh Gate':'黑金闸口','Ravaged Path':'荒芜小道','Sendoff Spring':'送行之泉',
  'Snowpoint Temple':'雪峰神殿','Stark Mountain':'严酷山','Trophy Garden':'自豪的后院',
  'Valley Windworks':'山谷发电厂','Valor Lakefront':'立志湖畔','Moor of Icirrus':'雪花湿地',
  'Relic Castle':'古代城',
  'Three Isle Port':'第三岛码头','Desert Underpass':'沙漠的地下道',
};
const position={'Bottom Center':'下方中间','Bottom Left':'左下','Bottom Right':'右下','Bottom':'下方',
  'Left Center':'左侧中间','Left':'左侧','Middle Center':'正中','Middle Left':'中间偏左','Middle Right':'中间偏右',
  'Middle Top':'中间偏上','Right':'右侧','Top Center':'上方中间','Top Left':'左上','Top Right':'右上','Top':'上方',
  'East':'东侧','West':'西侧','Center':'中间','Main Entrance':'主入口','Secret Room':'隐藏房间'};

export function translateArea(value,region){
  const area=String(value||'').trim();
  if(area==='Lighthouse'&&region==='johto')return '光辉灯塔';
  if(names[area])return names[area];
  const route=/^Route (\d{1,3})$/i.exec(area);if(route)return `${Number(route[1])}号道路`;
  const section=/^(Giant Chasm|Pinwheel Forest) \((Cave|Entrance|Forest|Inner|Outer)\)$/i.exec(area);
  if(section)return `${names[section[1]]}（${{Cave:'洞穴',Entrance:'入口',Forest:'森林',Inner:'内部',Outer:'外围'}[section[2]]}）`;
  return area;
}

export function translateDetail(value){
  let detail=String(value||'').trim();if(!detail)return detail;
  if(detail==='idk')return '具体位置不详';
  detail=detail.replace(/\b(B\d+F|\d+F|F\d+)\b/g,floor=>floor.startsWith('B')?`地下${floor.slice(1,-1)}层`:`${floor.replace(/\D/g,'')}层`)
    .replace(/\bRooftop\b/g,'屋顶').replace(/\bOutside\b/g,'室外').replace(/\bTunnel\b/g,'隧道')
    .replace(/\b(Secret Room|Main Entrance|Bottom Center|Bottom Left|Bottom Right|Left Center|Middle Center|Middle Left|Middle Right|Middle Top|Top Center|Top Left|Top Right|Bottom|Left|Right|Top|East|West|Center)\b/g,part=>position[part]);
  return detail.replace(/\(/g,'（').replace(/\)/g,'）');
}

export function translateLocation(value,region){
  const raw=String(value||'').trim();const [area,...parts]=raw.split(/\s*·\s*/);
  return [translateArea(area,region),...parts.map(translateDetail)].join(' · ');
}
