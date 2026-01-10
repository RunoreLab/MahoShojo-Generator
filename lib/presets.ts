export interface Preset {
  name: string;
  description: string;
  filename: string;
  type: 'magical-girl' | 'canshou';
}

// 预设列表 - Edge Runtime 无法读取文件系统，因此使用静态列表作为单一真相来源。
export const PRESET_LIST: Preset[] = [
  // 魔法少女
  {
    name: "翠雀",
    description: "樊笼下的蓝翠雀：身经百战的前辈，外冷内热的魔法少女。【强度：大杯】",
    filename: "M01_centaurea.json",
    type: "magical-girl"
  },
  {
    name: "白玫",
    description: "小草包：渴望认可的理想主义者，以“翠雀”为目标努力的成长型新人。",
    filename: "M02_white_rose.json",
    type: "magical-girl"
  },
  {
    name: "小锦",
    description: "拿最多的信息，打最少的输出：天赋异禀但缺乏安全感的魔法少女，渴望真正的'家'。",
    filename: "M03_little_brocade.json",
    type: "magical-girl"
  },
  {
    name: "薄雪",
    description: "野兽心境：以治愈之力行复仇之事的战斗天才。",
    filename: "M04_boxue.json",
    type: "magical-girl"
  },
  {
    name: "鸢",
    description: "爪痕兽心：只相信自身技艺的武痴，行走于阴影中的反权威者。超大杯守门员。【强度：超大杯】",
    filename: "M05_kite.json",
    type: "magical-girl"
  },
  {
    name: "麻雀",
    description: "牢雀：正被关在调查院地牢里承受挠痒痒酷刑。",
    filename: "M06_sparrow.json",
    type: "magical-girl"
  },
  {
    name: "玛格丽特",
    description: "调酒师：以情绪为武器的万能'润滑剂'，张扬自信的调查院前辈。",
    filename: "M07_margaret.json",
    type: "magical-girl"
  },
  {
    name: "朝颜",
    description: "科技与狠活：背负他人身影的'记录者'，活在悔恨与爱恋中的败犬，让人怀疑她是不是有在吃代餐。",
    filename: "M08_asagao.json",
    type: "magical-girl"
  },
  {
    name: "松花",
    description: "圣地巡礼：热衷圣地巡礼的摸鱼少女，能将回忆凝固为琥珀。",
    filename: "M09_pine_flower.json",
    type: "magical-girl"
  },
  {
    name: "艾草",
    description: "言出必行：言出法随的靠谱魔法少女，能将记录的话语化为力量。",
    filename: "M10_mugwort.json",
    type: "magical-girl"
  },
  {
    name: "向日葵",
    description: "旧景重现：追逐大新闻的乐子人，能将照片中的景象再现。",
    filename: "M11_sunflower.json",
    type: "magical-girl"
  },
  {
    name: "雪绒",
    description: "大道至简：专打机制怪和说书人。超大杯质检员。【强度：超大杯】",
    filename: "M12_greatness_in_simplicity.json",
    type: "magical-girl"
  },
  {
    name: "雪绒（日常）",
    description: "大道至简·日常版：短暂放下雪绒的代号，正享受日常生活和果茶的普通（？）少女，雪沫。",
    filename: "M16_xuemo.json",
    type: "magical-girl"
  },
  {
    name: "千日红",
    description: "大道至繁：星穹的魔女，大道至简的对立面，头脑简单的莽夫之大敌。【强度：超大杯】",
    filename: "M13_greatness_in_complexity.json",
    type: "magical-girl"
  },
  {
    name: "翠雀（心魔雀）",
    description: "爪痕领袖：将爪痕作为己身复仇工具的可能性。【强度：中杯】",
    filename: "M14_centaurea_claw_marks.json",
    type: "magical-girl"
  },
  {
    name: "翠雀（心中雀）",
    description: "宝石权杖：并未拒绝蓝宝石权杖之位的可能性。【强度：超大杯】",
    filename: "M15_centaurea_in_heart.json",
    type: "magical-girl"
  },
  {
    name: "鹅",
    description: "咕咕嘎嘎：被强烈要求加入的一只鹅，据说已经把魔法少女啄麻了。",
    filename: "M90_goose.json",
    type: "magical-girl"
  },
  // 自由现编（留白预设）
  {
    name: "魔法少女",
    description: "留白模板：外观/魔装/奇境会根据具体情况编写，比较随机。",
    filename: "U_MG_solo.json",
    type: "magical-girl"
  },
  {
    name: "弱小的魔法少女",
    description: "留白模板：更偏新人/负伤/资源不足，能力不稳定但更贴近求生。",
    filename: "U_MG_solo_weak.json",
    type: "magical-girl"
  },
  {
    name: "强大的魔法少女",
    description: "留白模板：更偏经验丰富/体系完整，能快速适配战场并收束战局。",
    filename: "U_MG_solo_strong.json",
    type: "magical-girl"
  },
  {
    name: "顶尖魔法少女",
    description: "留白模板：顶尖层次的魔法少女，例如传说中的“物质界最强”、“最强花牌”。",
    filename: "U_MG_solo_top.json",
    type: "magical-girl"
  },
  {
    name: "魔法少女小队",
    description: "留白模板：成员/分工可变，强调协作与合击的团队作战。",
    filename: "U_MG_team.json",
    type: "magical-girl"
  },
  {
    name: "弱小的魔法少女小队",
    description: "留白模板：临时编队/新人小队，配合不成熟但更有成长空间。",
    filename: "U_MG_team_weak.json",
    type: "magical-girl"
  },
  {
    name: "强大的魔法少女小队",
    description: "留白模板：体系化协作与战术奇境，适合写团队压制与补位反打。",
    filename: "U_MG_team_strong.json",
    type: "magical-girl"
  },
  {
    name: "顶尖魔法少女小队",
    description: "留白模板：近规则级协同，终局感强，适合大战役/主线收束。",
    filename: "U_MG_team_top.json",
    type: "magical-girl"
  },
  // 残兽
  {
    name: "溶腔型-卵",
    description: "新人杀手：巨大肉块状的初级残兽，能喷射腐蚀性液体。",
    filename: "C01_egg.json",
    type: "canshou"
  },
  {
    name: "双头猎犬-蠖",
    description: "湿地魅影：拥有双头和野兽智慧的敏捷猎手，擅长追猎与夹击。",
    filename: "C02_pupa.json",
    type: "canshou"
  },
  {
    name: "合唱团与舞者-蛹",
    description: "下水道的歌剧：歌声操控一切的巨大鱼形残兽，极度危险的区域控制者。",
    filename: "C03_choir_and_dancer.json",
    type: "canshou"
  },
  {
    name: "血肉蛛网-蛹",
    description: "捕食的巢穴：由血肉构成的巨大蛛网，能扭曲空间并捕获猎物。",
    filename: "C04_flesh_spider_web.json",
    type: "canshou"
  },
  {
    name: "殿前烬卫白蛛-半蜕",
    description: "忠诚的守护者：与人类融合的巨大白色蜘蛛，掌握规则之力的强大战士。",
    filename: "C05_cinder_guard_spider.json",
    type: "canshou"
  },
  {
    name: "蛾-蜕",
    description: "黑夜，黎明：梦幻而致命的巨大飞蛾，拥有完整巢穴与规则的灾难化身。",
    filename: "C06_moth.json",
    type: "canshou"
  },
  {
    name: "归一之璞-蜕",
    description: "大道至简II：或许是尝试融合“大道至简”，却被其本身吞噬的残兽。",
    filename: "C07_returning_to_simplicity.json",
    type: "canshou"
  },
  {
    name: "寂响之虫-蠖",
    description: "苍黑残响：由黑曜石和振动空气构成的巨大蝉蛹，使用声音相关的攻击方式。",
    filename: "C08_silent_worm.json",
    type: "canshou"
  },
  // 自由现编（留白预设）
  {
    name: "残兽",
    description: "留白模板：概念/形态会根据具体情况编写，比较随机。",
    filename: "U_CS_solo.json",
    type: "canshou"
  },
  {
    name: "弱小的残兽",
    description: "留白模板：偏早期个体与简单概念，适合新人遭遇战或引子事件。",
    filename: "U_CS_solo_weak.json",
    type: "canshou"
  },
  {
    name: "强大的残兽",
    description: "留白模板：更接近系统性灾害，拥有清晰概念与领域倾向。",
    filename: "U_CS_solo_strong.json",
    type: "canshou"
  },
  {
    name: "残兽首领",
    description: "留白模板：具统御与群体链接倾向，适合作为道中BOSS或者统御残兽群。",
    filename: "U_CS_solo_boss.json",
    type: "canshou"
  },
  {
    name: "残兽群",
    description: "留白模板：群体共鸣与协作捕食，适合城市小规模灾害与围猎局。",
    filename: "U_CS_horde.json",
    type: "canshou"
  },
  {
    name: "弱小的残兽群",
    description: "留白模板：规模较小/结构松散，适合混乱与压迫感的铺垫。",
    filename: "U_CS_horde_weak.json",
    type: "canshou"
  },
  {
    name: "强大的残兽群",
    description: "留白模板：层级分工与巢穴化明显，适合攻城式推进与分队被迫抉择。",
    filename: "U_CS_horde_strong.json",
    type: "canshou"
  },
  {
    name: "兽潮",
    description: "留白模板：现象级灾害，战斗往往变为撤离/护送/止损与英雄主义。",
    filename: "U_CS_horde_tide.json",
    type: "canshou"
  }
];
