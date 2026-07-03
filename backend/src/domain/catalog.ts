import type { BotCourseCode } from "@prisma/client";

export const DEFAULT_MANAGER_ID = 221231;
export const TRIAL_PRICE_KOPECKS = 60_000;
export const REFERRAL_TRIAL_PRICE_KOPECKS = 30_000;
export const TEST_PAYMENT_KOPECKS = 100;
export const TRIAL_LOOKUP_DAYS = 14;

export type BranchSeed = {
  code: string;
  name: string;
  address: string;
  moyklassId: number;
  baseUrl: string;
};

export const BRANCHES: BranchSeed[] = [
  {
    code: "YANINO",
    name: "Янино",
    address: "ул. Рембрандта, 4",
    moyklassId: 54009,
    baseUrl: "https://codorobot.ru"
  },
  {
    code: "YUZHNY",
    name: "Южный",
    address: "Центральная ул., 2",
    moyklassId: 5425,
    baseUrl: "https://codologia-vsev.ru"
  },
  {
    code: "KOLTUSHI",
    name: "Колтуши",
    address: "ул. Генерала Чоглокова, 2",
    moyklassId: 25020,
    baseUrl: "https://codologia-vsev.ru"
  },
  {
    code: "VSEVOLOZHSK",
    name: "Всеволожск",
    address: "Октябрьский пр., 83",
    moyklassId: 11514,
    baseUrl: "https://codologia-vsev.ru"
  }
];

export type CourseSeed = {
  code: BotCourseCode;
  title: string;
  slug: string;
  description: string;
  defaultUrl: string;
  defaultMoyklassCourseId: number;
};

const mathDescription =
  "Математика задает стандарты правильного, рационального мышления, дает огромный толчок для умственного развития. Она нужна умным и способным детям, которым скучно на занятиях математики в детском саду.";

export const COURSE_CATALOG: CourseSeed[] = [
  {
    code: "WEDO",
    title: "Wedo 2.0",
    slug: "lego-wedo",
    description:
      "На занятиях на базе образовательных наборов LEGO ребята конструируют роботов и программируют их на компьютере. Ребята изучают устройства и роботов, которые нас окружают и не только собирают роботов но и познают окружающий мир!",
    defaultUrl: "/courses/lego-wedo",
    defaultMoyklassCourseId: 156099
  },
  {
    code: "MATH_1",
    title: "Математика 1 ур",
    slug: "olympiad-math-1-lvl",
    description: mathDescription,
    defaultUrl: "/courses/olympiad-math-1-lvl",
    defaultMoyklassCourseId: 156786
  },
  {
    code: "MATH_2",
    title: "Математика 2 ур",
    slug: "olympiad-math-2-lvl",
    description: mathDescription,
    defaultUrl: "/courses/olympiad-math-2-lvl",
    defaultMoyklassCourseId: 156786
  },
  {
    code: "DIGITAL_LITERACY",
    title: "Цифровая грамотность",
    slug: "digital-literacy",
    description:
      "Ребята погружаются в разные направления программирования. Результатом будут итоговые проекты ребенка. Ребят ждет Microsoft Office, Scratch, PixelArt, графический дизайн и мобильная разработка. Этот курс - уверенный фундамент для ребенка",
    defaultUrl: "/courses/digital-literacy",
    defaultMoyklassCourseId: 156093
  },
  {
    code: "EV3",
    title: "EV3",
    slug: "lego-ev3",
    description:
      "Этот курс нацелен на конструирование различных моделей роботов, применение функциональных датчиков света, расстояния и др. На занятиях проходят соревнования на прохождение трасс и лабиринтов. Ребята смогут создать собственные уникальные робомашины",
    defaultUrl: "/courses/lego-ev3",
    defaultMoyklassCourseId: 170128
  },
  {
    code: "ARDUINO",
    title: "Arduino",
    slug: "arduino",
    description:
      "Arduino - это микрокомпьютер, для которого можно написать программу по управлению различных датчиков, модулей или устройств. Ребенок познает азы физики, механики, схемотехники и электроники. Ребята учатся создавать компоненты умного дома",
    defaultUrl: "/courses/arduino",
    defaultMoyklassCourseId: 156100
  },
  {
    code: "ROBLOX",
    title: "Roblox",
    slug: "3d-games",
    description:
      "На этом курсе ребята увидят, как на самом деле создается 3D игра, узнают секреты создания любимых игр, почувствуют себя крутыми разработчиками, весело и с пользой проведут время!",
    defaultUrl: "/courses/3d-games",
    defaultMoyklassCourseId: 156094
  },
  {
    code: "UNITY",
    title: "Unity",
    slug: "unity3d",
    description:
      "Это среда разработки компьютерных игр. Unity позволяет создать игру, которая будет работать на 90% устройств: пк, телефонах, консолях. Unity и C# даются ребятам в крепкой связке. В конце курса у ребят будет готов полноценный сложный игровой продукт",
    defaultUrl: "/courses/unity3d",
    defaultMoyklassCourseId: 156097
  },
  {
    code: "PYTHON",
    title: "Python",
    slug: "python",
    description:
      "Курс Python нацелен на изучение языка и изучение методов его использования. На курсе ребята познакомятся с основами программирования на этом языке, изучат циклы for и while, изучат модуль turtle. Занятия состоят из теоретической и практической части",
    defaultUrl: "/courses/python",
    defaultMoyklassCourseId: 156096
  },
  {
    code: "DESIGN",
    title: "Графический дизайн",
    slug: "design",
    description:
      "Почему графический дизайн - это интересно? Потому что это очень творческое направление! Ребята придумают своих героев, полностью с нуля спроектируют дом, создадут дизайн комнат, а также научатся предметному моделированию",
    defaultUrl: "/courses/design",
    defaultMoyklassCourseId: 156095
  }
];

export const TRIAL_INTRO_MESSAGES = [
  "Мы предлагаем Вам посетить наше пробное занятие!",
  "Пробное занятие - это полноценный двухчасовой урок",
  "За это время у ребенка будет возможность не просто посмотреть что и как устроено, но и попробовать свои силы на конкретном курсе",
  "В некоторых случаях создать полноценный IT проект",
  "У педагога появится возможность познакомиться с ребенком и дать свои рекомендации по окончании урока, с чего стоит начать, на что обратить внимание"
];

export const COURSE_OPTION_LABELS = {
  start: "С чего начать",
  robotics: "Робототехника",
  math: "Математика",
  design: "Дизайн",
  games: "Создание игр",
  programming: "Программирование",
  ev3: "EV3",
  arduino: "Arduino",
  roblox: "Roblox",
  unity: "Unity"
} as const;

export type PrimaryCourseOption =
  | "start"
  | "robotics"
  | "math"
  | "design"
  | "games"
  | "programming";

export type SubCourseOption = "ev3" | "arduino" | "roblox" | "unity";
