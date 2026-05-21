export type Locale = "zh" | "fr";

export const defaultLocale: Locale = "zh";
export const locales: Locale[] = ["zh", "fr"];

export function normalizeLocale(value: string | undefined): Locale {
  return value === "fr" ? "fr" : "zh";
}

export const dictionaries = {
  zh: {
    meta: {
      title: "SACIS 3.0 | 科建地产房屋管理系统",
      description: "11#公寓首期业务管理系统"
    },
    shell: {
      brand: "科建地产",
      currentBuilding: "当前楼栋",
      language: "中文",
      otherLanguage: "Français",
      roles: {
        admin: "管理员",
        boss: "老板",
        finance: "财务",
        front_desk: "前台"
      },
      notifications: {
        title: "通知中心",
        empty: "暂无通知",
        markRead: "标记已读",
        markAllRead: "全部已读",
        unread: "未读",
        leaseExpiry: "长租到期提醒",
        rentOverdue: "租金逾期提醒",
        saleInstallment: "出售分期提醒",
        dailyCheckout: "日租退房提醒"
      },
      nav: {
        dashboard: "仪表盘",
        units: "11#房源",
        dailyRentals: "日租",
        dailyOccupancy: "日租占用",
        leases: "长租",
        sales: "出售",
        customers: "客户",
        finance: "财务",
        reports: "报表",
        settings: "设置",
        management: "经营驾驶舱",
        documents: "单据中心",
        todos: "通知待办"
      }
    },
    statuses: {
      available: "空闲",
      reserved: "预订",
      daily_occupied: "日租中",
      cleaning_pending: "待保洁",
      leased: "长租中",
      sold: "已售",
      maintenance: "维修/停用",
      locked: "已锁定"
    },
    dashboard: {
      title: "11#公寓运营仪表盘",
      description: "首期只启用 11#公寓，但所有数据结构保留多楼栋扩展字段。这里先承载日租、长租、出售三条业务线的总览入口。",
      metrics: {
        mainUnits: ["主楼房源", "72户", "1-12F，每层 101-106"],
        dailyUnits: ["日租房源", "21间", "固定房间，统一 40,000 XOF/晚"],
        businessTypes: ["业务类型", "3类", "日租、长租、出售"],
        futureBuildings: ["扩展楼栋", "5栋预留", "3#/4#/5#/6#/7# 后续导入"]
      },
      modules: [
        ["11#房源总览", "主楼、车库、业务属性和房态管理", "72户 + 车库", "/units"],
        ["日租业务", "21间固定日租房、预订、入住、退房、保洁", "40,000 XOF/晚", "/daily-rentals"],
        ["长租业务", "合同、应收、押金、退租结算", "按户型定价", "/leases"],
        ["出售业务", "出售合同、分期收款、过户跟进", "房源 + 车位", "/sales"]
      ]
    },
    units: {
      title: "11#房源总览",
      description: "房源表按多楼栋设计，首期筛选 building_code = SASCI11。后续新增楼栋只需要导入楼栋、房间和业务属性。",
      headers: ["房号", "楼层", "类型", "房态", "支持业务", "日租价"],
      empty: "暂无房源数据，请先导入楼栋和房间。",
      filters: {
        all: "全部",
        floor: "楼层",
        status: "房态",
        kind: "类型",
        business: "业务类型"
      },
      kinds: {
        apartment: "公寓",
        parking: "车位",
        storefront: "门面",
        office: "办公"
      },
      businessTypes: {
        daily_rental: "日租",
        long_lease: "长租",
        sale: "出售"
      },
      furnishing: {
        none: "无家具",
        basic: "基础家具",
        full: "齐全家具"
      },
      actions: {
        import: "批量导入",
        export: "导出Excel",
        changeStatus: "修改房态",
        viewDetail: "查看详情"
      },
      detail: {
        title: "房间详情",
        code: "编号",
        building: "楼栋",
        floor: "楼层",
        kind: "类型",
        status: "房态",
        area: "面积",
        areaUnit: "㎡",
        layout: "户型",
        furnishing: "家具配置",
        dailyPrice: "日租价格",
        dailyPriceUnit: "XOF/晚",
        supportedBusiness: "支持业务",
        notes: "备注",
        noNotes: "暂无备注",
        photos: "房间照片",
        noPhotos: "暂无照片",
        statusHistory: "状态变更记录",
        noStatusHistory: "暂无状态变更记录",
        notSet: "未设置"
      },
      statusConfirm: "确认将房态修改为"
    },
    dailyRentals: {
      title: "日租业务",
      description: "仅 11#固定 21 间房支持日租。需要检测长租占用冲突，后续接入 OTA 双向同步。",
      metrics: [
        ["日租房源", "21间", "固定名单由数据库标记"],
        ["默认价格", "40,000 XOF", "可在订单中手动调整"],
        ["付款规则", "预付", "不可离店后付款"]
      ],
      steps: [
        ["预订", "创建预订单，人工审核确认"],
        ["入住", "登记客户，记录至少部分预付"],
        ["退房", "一键计算金额并生成收入流水"],
        ["保洁", "退房后自动生成保洁任务"]
      ],
      bookingStatus: {
        pending_review: "待审核",
        confirmed: "已确认",
        checked_in: "已入住",
        checked_out: "已退房",
        cancelled: "已取消"
      },
      calendar: {
        today: "今天",
        prevMonth: "上月",
        nextMonth: "下月",
        room: "房间",
        noRooms: "暂无日租房源",
        legendAvailable: "可订",
        legendBooked: "已订",
        legendMaintenance: "维修",
        legendReserved: "预订",
        nightlyPrice: "晚/间"
      },
      booking: {
        title: "日租预订",
        newBooking: "新建预订",
        editBooking: "编辑预订",
        checkIn: "办理入住",
        checkOut: "快速退房",
        extendStay: "续住",
        confirmBooking: "确认预订",
        cancelBooking: "取消预订",
        customer: "选择客户",
        checkInDate: "入住日期",
        checkOutDate: "退房日期",
        nights: "晚",
        nightlyPrice: "每晚价格",
        totalAmount: "总金额",
        prepaidAmount: "预付金额",
        remainingAmount: "待付余额",
        paymentRecord: "收款记录",
        recordPayment: "记录收款",
        receiptNo: "收据编号",
        otaSource: "OTA来源",
        notes: "备注",
        noCustomer: "请先选择客户",
        noBookings: "所选日期范围内无预订",
        confirmCheckIn: "确认办理入住",
        confirmCheckOut: "确认退房",
        calculatedTotal: "计算总金额",
        prepaidWarning: "至少需预付一部分，不可离店后付款",
        customerName: "客户姓名"
      },
      checkoutModeLabel: "入住模式",
      fixedCheckout: "固定离店",
      openCheckout: "开放式 — 未定离店",
      actualCheckOutDate: "实际退房日期",
      supplementaryPayment: "补缴收款",
      discount: "手动优惠",
      discountAmount: "优惠金额",
      discountReason: "优惠原因",
      applyDiscount: "应用优惠",
      billing: {
        grossAmount: "原价",
        discount: "优惠",
        finalAmount: "应收",
        paid: "已收",
        outstanding: "待补缴"
      },
      monthlyDiscountHint: "已住满 {nights} 晚，可考虑长住优惠。原价 {gross}，可手动输入优惠金额。",
      openEndedBadge: "开放式",
      fixedBadge: "固定离店",
      conflicts: {
        longLeaseConflict: "该房间存在生效的长租合同，无法预订此日期",
        doubleBooked: "该房间在所选日期已被预订",
        unitMaintenance: "该房间正在维修/停用",
        unitLocked: "该房间已被锁定"
      },
      cleaning: {
        title: "保洁任务",
        pending: "待保洁",
        completed: "已完成",
        markComplete: "标记完成",
        autoCreated: "退房后自动生成"
      },
      ota: {
        title: "OTA同步",
        placeholder: "OTA双向同步接口预留 — 后续实现"
      }
    },
    dailyOccupancy: {
      title: "日租占用总览",
      description: "每天发送到群里的共享视图：展示当前占用房间、客户、入住日期、预计到期日期、开放式入住和待补缴金额。",
      shareTitle: "今日可发群内容",
      copy: "复制群消息",
      headers: ["房间", "客户", "入住日期", "预计离店/到期", "已住天数", "计费方式", "已付", "应收", "待补缴", "备注"],
      billingModes: {
        fixed_checkout: "固定离店",
        open_ended: "开放式入住",
        monthly_discount: "满月优惠"
      },
      openEnded: {
        label: "离店日期未定",
        description: "入住后按天持续计费，后续一次或多次补缴。"
      },
      discountRule: {
        title: "满月优惠规则",
        example: "例如 30晚 x 4,000 = 120,000 XOF，可手动优惠收 110,000 XOF。",
        note: "优惠金额由管理员在结算时手动确认并写入审计日志。"
      },
      empty: "当前没有日租占用房间。",
      summary: {
        occupied: "占用房间",
        openEnded: "未定离店",
        dueSoon: "即将到期",
        outstanding: "待补缴"
      }
    },
    leases: {
      title: "长租业务",
      description: "合同编号手动输入，租金应收手动创建；一个房间同一时间只能有一份生效长租合同。",
      metrics: [["定价方式", "按户型", "允许合同内手动调整"], ["付款周期", "月/季/半年/年", "支持提前收款"], ["退租结算", "自动生成", "租金、水电、押金扣退"]],
      empty: "暂无长租合同，请创建第一份合同。",
      contractStatus: {
        draft: "草稿",
        active: "生效中",
        terminated: "已终止",
        expired: "已过期"
      },
      paymentCycle: {
        monthly: "月付",
        quarterly: "季付",
        semiannual: "半年付",
        annual: "年付"
      },
      form: {
        newContract: "新建合同",
        editContract: "编辑合同",
        contractNo: "合同编号",
        unit: "房源",
        customer: "客户",
        startDate: "起租日期",
        expectedEndDate: "预计退租日期",
        actualEndDate: "实际退租日期",
        paymentCycle: "支付周期",
        paymentDay: "付款日",
        monthlyRent: "月租金",
        deposit: "押金金额",
        depositReceived: "押金已收",
        rentFreeDays: "免租期天数",
        signerName: "签约人/代理人",
        attachment: "合同附件",
        notes: "备注",
        noUnit: "请选择房源",
        noCustomer: "请选择客户",
        unitOccupied: "该房源已有生效中的长租合同",
        contractNoRequired: "请输入合同编号",
        statusLabel: "状态",
        depositPaid: "✓已收",
        depositUnpaid: "未收",
        activateContract: "激活合同",
      },
      payment: {
        title: "租金收款",
        record: "记录收款",
        amount: "收款金额",
        paymentDate: "收款日期",
        receiptNo: "收据编号",
        coveringMonths: "覆盖月份",
        advancePayment: "提前收款（预收未来月份）",
        fullPaymentRequired: "长租收款必须全额付清",
        totalPaid: "已收总额",
        expectedRent: "应收租金",
        remaining: "待收余额"
      },
      settlement: {
        title: "退租结算",
        moveOut: "退租并结算",
        unpaidRent: "未付租金",
        utilityCleared: "水电费已结清",
        depositDeduction: "押金扣除（损坏赔偿）",
        depositRefund: "退还押金",
        totalRefund: "应退金额",
        totalDue: "应补金额",
        generateSettlement: "生成退租结算单",
        settlementNote: "结算完成后房态恢复为空闲"
      },
      reminder: {
        title: "逾期提醒",
        dueSoon: "即将到期",
        overdue: "已逾期",
        daysLeft: "剩余天数",
        sendReminder: "发送提醒"
      },
      receivable: {
        title: "租金应收列表",
        generate: "生成应收",
        generated: "已生成 {count} 条应收",
        none: "暂无应收记录，请先生成应收",
        dueDate: "应收日期",
        amount: "应收金额",
        paid: "已收金额",
        outstanding: "未收金额",
        status: "状态",
        overdueDays: "逾期天数",
        collect: "收款",
        fullPaymentNote: "长租必须全额付清该笔应收",
      },
      risk: {
        outstandingTotal: "未收总额",
        overdueTotal: "逾期总额",
        depositStatus: "押金状态",
        expiringSoon: "合同即将到期",
        noRisk: "暂无风险",
      },
    },
    sales: {
      title: "出售业务",
      description: "支持房源和车位出售，一次性付清、固定期数分期、灵活期数分期全部预留。",
      metrics: [["可售范围", "房源/车位", "11#主楼与 G/0 车库"], ["付款方式", "3种", "一次性、固定分期、灵活分期"], ["合同状态", "可恢复", "违约终止后恢复可售"]],
      empty: "暂无出售合同，请创建第一份合同。",
      contractStatus: {
        draft: "草稿",
        active: "生效中",
        terminated: "已终止",
        expired: "已过期"
      },
      paymentPlan: {
        lump_sum: "一次性付清",
        fixed_installment: "固定期数分期",
        flexible_installment: "灵活期数分期"
      },
      transferStatus: {
        not_started: "未过户",
        in_progress: "过户中",
        completed: "已完成"
      },
      form: {
        newContract: "新建出售合同",
        editContract: "编辑合同",
        contractNo: "合同编号",
        unit: "房源/车位",
        customer: "买方客户",
        signedDate: "签约日期",
        totalAmount: "合同总价",
        paymentPlan: "付款方式",
        numInstallments: "分期期数",
        transferDate: "过户日期",
        transferStatus: "过户状态",
        titleCertificateNo: "产权证号",
        agencyCompany: "中介公司",
        agentName: "经纪人",
        agencyCommission: "中介佣金",
        agencyCommissionPaid: "佣金已付",
        attachment: "合同附件",
        notes: "备注",
        noUnit: "请选择可售房源",
        noCustomer: "请选择客户",
        contractNoRequired: "请输入合同编号",
        statusLabel: "状态",
        addSchedule: "添加",
        updateTransfer: "更新过户状态",
      },
      installment: {
        title: "分期付款计划",
        installmentNo: "期数",
        dueDate: "截止日期",
        amount: "金额",
        status: "状态",
        paid: "已付",
        pending: "待付",
        overdue: "逾期",
        addInstallment: "添加分期",
        earlyRepayment: "提前还款",
        progress: "回款进度"
      },
      payment: {
        title: "收款记录",
        record: "记录收款",
        amount: "收款金额",
        paymentDate: "收款日期",
        receiptNo: "收据编号",
        selectInstallment: "选择对应分期",
        totalPaid: "已收总额",
        remaining: "剩余尾款"
      },
      terminate: {
        title: "合同终止",
        confirm: "确认终止合同",
        description: "终止后房源恢复可售状态，已收款项保留记录。",
        reason: "终止原因"
      },
      overview: {
        title: "回款概览",
        totalPrice: "合同总价",
        paidAmount: "已收金额",
        unpaidAmount: "未收金额",
        overdueAmount: "逾期金额",
        collectionRate: "回款率",
      },
      paymentValidation: {
        amountExceeds: "金额不能超过未收金额",
        alreadyPaid: "该期已付清",
        positiveRequired: "金额必须大于0",
      },
    },
    customers: {
      title: "客户档案",
      description: "跨日租、长租、出售共享客户中心。姓名必填，证件号加密存储，黑名单全局生效。",
      placeholder: "后续实现：客户列表、客户详情、重复客户合并、黑名单、客户数据导出/删除。",
      empty: "暂无客户数据，请添加第一位客户。",
      searchPlaceholder: "搜索客户姓名...",
      fields: {
        name: "姓名",
        gender: "性别",
        documentType: "证件类型",
        documentNumber: "证件号码",
        phone: "手机号码",
        notes: "备注"
      },
      gender: {
        male: "男",
        female: "女",
        other: "其他"
      },
      documentTypes: {
        id_card: "身份证",
        passport: "护照",
        drivers_license: "驾照"
      },
      blacklist: {
        title: "黑名单",
        reason: "拉黑原因",
        operator: "操作人",
        date: "日期",
        permanent: "永久",
        temporary: "临时",
        add: "加入黑名单",
        remove: "解除黑名单",
        warnTitle: "该客户已被加入黑名单",
        warnMessage: "黑名单客户无法创建新的业务单据。",
        reasonRequired: "请填写拉黑原因"
      },
      actions: {
        add: "新增客户",
        edit: "编辑",
        save: "保存",
        cancel: "取消",
        merge: "合并客户",
        mergePlaceholder: "客户去重合并 — 后续实现"
      },
      validation: {
        nameRequired: "请输入客户姓名",
        nameMinLength: "姓名至少2个字符"
      }
    },
    finance: {
      title: "财务流水",
      description: "统一记录日租收入、长租租金、押金、出售房款和其他收支；报表统一换算为万 XOF。",
      metrics: [["币种", "XOF/CNY", "汇率手动录入"], ["收据编号", "必留字段", "匹配公司纸质收据"], ["会计接口", "预留 API", "当前先导出 Excel/CSV"]],
      empty: "暂无财务流水记录。",
      directions: {
        income: "收入",
        expense: "支出",
        liability_in: "押金收",
        liability_out: "押金退"
      },
      categories: {
        daily_rental: "日租收入",
        lease_rent: "长租租金",
        lease_deposit: "长租押金",
        sale: "出售房款",
        other_income: "其他收入",
        maintenance: "维修费",
        cleaning_wages: "保洁工资",
        garbage: "垃圾清运费",
        utilities: "水电燃气费",
        property_management: "物业管理外包费",
        tax: "税费",
        agency_commission: "中介佣金",
        other_expense: "其他支出"
      },
      filters: {
        all: "全部",
        dateRange: "日期范围",
        direction: "收支类型",
        category: "类别",
        building: "楼栋",
        unit: "房间"
      },
      entry: {
        title: "新增流水",
        date: "日期",
        direction: "类型",
        category: "类别",
        amount: "金额",
        currency: "币种",
        exchangeRate: "汇率(XOF=1)",
        amountXof: "折合XOF",
        description: "说明",
        receiptNo: "收据编号",
        building: "关联楼栋",
        unit: "关联房间",
        save: "保存"
      },
      summary: {
        totalIncome: "总收入",
        totalExpense: "总支出",
        netBalance: "净余额",
        period: "期间"
      },
      export: {
        csv: "导出CSV",
        excel: "导出Excel",
        apiPlaceholder: "会计API接口预留 — 后续实现"
      }
    },
    reports: {
      title: "报表中心",
      description: "首期报表默认筛选 11#公寓，数据库层保留 building_id 以支持未来多楼栋横向对比。",
      items: ["月度收支总表", "11#利润表", "日租入住率", "长租空置率", "出售回款进度", "现金流量表"],
      placeholder: "后续接入 Supabase 查询、图表和导出。",
      dateRange: "报表期间",
      unit: "万 XOF",
      empty: "所选期间暂无数据",
      emailSchedule: "定时发送邮箱 — 后续实现",
      monthlySummary: {
        title: "月度收支总表",
        period: "月份",
        income: "收入",
        expense: "支出",
        net: "净额"
      },
      occupancy: {
        title: "日租入住率",
        room: "房间",
        nightsBooked: "已订夜数",
        nightsAvailable: "可订夜数",
        rate: "入住率",
        totalDays: "统计天数"
      },
      vacancy: {
        title: "长租空置率",
        totalUnits: "可租房源",
        leasedUnits: "已租房源",
        vacantUnits: "空置房源",
        rate: "空置率"
      },
      saleProgress: {
        title: "出售回款进度",
        contract: "合同",
        totalAmount: "合同总价",
        paidAmount: "已收金额",
        progress: "回款比例",
        remaining: "待收尾款"
      }
    },
    settings: {
      title: "系统设置",
      description: "集中管理楼栋启用、价格规则、滞纳金比例、公司信息、模板、角色权限和外部接口。",
      placeholder: "后续实现：多楼栋管理、用户角色、双语文案、深色模式、备份、短信/WhatsApp/API 接口配置。",
      buildings: {
        title: "楼栋管理",
        add: "新增楼栋",
        code: "楼栋编号",
        displayName: "显示名称",
        floors: "地上楼层",
        elevators: "电梯数",
        active: "启用",
        paused: "暂停业务",
        actions: "操作",
        confirmAdd: "确认新增",
        noBuildings: "暂无楼栋数据",
        codeRequired: "请输入楼栋编号",
        codeFormat: "格式：SASCI3 ~ SASCI11"
      },
      pricing: {
        title: "价格配置",
        dailyDefault: "日租默认价格",
        dailyDefaultDesc: "11#固定21间日租房每晚默认价格",
        lateRate: "滞纳金比例",
        lateRateDesc: "每天万分之X，长租逾期自动计算",
        save: "保存价格配置"
      },
      company: {
        title: "公司信息",
        name: "公司名称",
        address: "地址",
        phone: "电话",
        logo: "公司Logo",
        save: "保存公司信息",
        desc: "用于打印模板和报表抬头"
      },
      language: {
        title: "语言设置",
        zh: "中文（简体）",
        fr: "Français",
        current: "当前语言"
      },
      darkMode: {
        title: "深色模式",
        toggle: "切换深色模式",
        placeholder: "深色模式 — 后续实现"
      },
      print: {
        leaseContract: "长租合同",
        leaseSettlement: "退租结算单",
        dailyReceipt: "日租收据",
        cleaningTask: "保洁任务单",
        overdueNotice: "欠款催交通知单",
        print: "打印",
        companyName: "科建地产",
        contractNo: "合同编号",
        date: "日期",
        total: "合计",
        signature: "签字"
      }
    },
    mobile: {
      today: "今日房态",
      occupied: "占用中",
      checkingOut: "今日退房",
      cleaning: "待保洁",
      needTopUp: "需补缴",
      reminders: "重要提醒",
      allClear: "今日无事，一切正常",
      desktopOnly: "请在电脑端使用完整功能",
      desktopOnlyHint: "手机端仅支持查阅和简单操作",
      workbench: "工作台",
      daily: "日租",
      units: "房源",
      profile: "我的",
      tabs: {
        occupied: "占用",
        checkingOut: "今日退房",
        cleaning: "待保洁",
        all: "全部",
      },
      stats: {
        occupied: "占用中",
        checkingOut: "今日退房",
        cleaning: "待保洁",
        available: "空闲",
      },
      roomCard: {
        checkOut: "退房",
        pay: "补缴",
        cleaningDone: "完成保洁",
        more: "更多",
        nights: "晚",
        copyPhone: "复制电话",
      },
      drawer: {
        title: "房间详情",
        guest: "客人",
        checkIn: "入住",
        checkOut: "离店",
        openEnded: "未定",
        nights: "已住天数",
        paid: "已收",
        total: "应收",
        outstanding: "欠费",
        notes: "备注",
        noNotes: "无备注",
      },
      actions: {
        checkOut: "退房",
        checkOutConfirm: "确认退房？",
        checkOutDesc: "退房后房间将变为待保洁状态",
        recordPayment: "记录补缴",
        recordPaymentTitle: "补缴金额",
        recordPaymentPlaceholder: "输入金额",
        completeCleaning: "完成保洁",
        maintenance: "标记维修",
        maintenanceConfirm: "确认标记维修？",
        maintenanceDesc: "维修期间房间不可出租",
        lock: "锁定房间",
        lockConfirm: "确认锁定房间？",
        lockDesc: "锁定后房间不可出租",
        markAvailable: "恢复可用",
        markAvailableConfirm: "确认恢复可用？",
        markAvailableDesc: "房间将重新开放出租",
        success: "操作成功",
        failed: "操作失败",
        cancel: "取消",
        confirm: "确认",
        extendStay: "延长入住",
        extendStayDesc: "修改预计离店日期",
        modifyDates: "修改日期",
        save: "保存",
        amountRequired: "请输入有效金额",
      },
      empty: {
        noOccupied: "当前无占用房间",
        noCheckouts: "今日无退房",
        noCleaning: "暂无待保洁房间",
        noRooms: "暂无房间数据",
        noAvailable: "暂无空闲房间",
        noReserved: "暂无已预订房间",
      },
    },
    receivables: {
      title: "应收账款",
      description: "统一管理日租、长租、出售应收款项，跟踪收款进度与逾期情况。",
      tabs: {
        ledger: "流水",
        receivables: "应收账款",
      },
      filters: {
        all: "全部",
        status: "状态",
        sourceType: "来源",
        dateRange: "日期范围",
        building: "楼栋",
      },
      statuses: {
        pending: "待收",
        partial: "部分收款",
        paid: "已收",
        overdue: "逾期",
        cancelled: "已取消",
      },
      sourceTypes: {
        daily_booking: "日租",
        lease_contract: "长租",
        sale_contract: "出售",
        manual: "手工",
      },
      categories: {
        daily_rental: "日租收入",
        lease_rent: "长租租金",
        lease_deposit: "长租押金",
        sale_installment: "出售分期",
        sale_lump_sum: "出售一次性",
        other: "其他",
      },
      columns: {
        dueDate: "应收日期",
        building: "楼栋",
        unit: "房间",
        customer: "客户",
        sourceType: "来源",
        category: "类别",
        title: "标题",
        amount: "应收金额",
        paid: "已收金额",
        outstanding: "未收金额",
        status: "状态",
        overdueDays: "逾期天数",
      },
      summary: {
        totalReceivable: "应收总额",
        totalPaid: "已收总额",
        totalOutstanding: "未收总额",
        totalOverdue: "逾期总额",
        collectionRate: "收款率",
      },
      export: {
        csv: "导出CSV",
      },
      empty: "暂无应收账款记录。",
    },
    management: {
      title: "经营驾驶舱",
      description: "管理层视角：楼栋房源状态、财务概况与风险提醒。数据来自现有业务表，不做额外汇总存储。",
      allBuildings: "全部楼栋",
      sections: {
        buildingStatus: "楼栋房源状态",
        financeOverview: "本月财务概况",
        riskAlerts: "风险提醒",
        roomMatrix: "房态矩阵",
        receivableOverview: "应收账款总览",
        receivableByBusiness: "按业务类型拆分",
        receivableByBuilding: "按楼栋拆分",
        overdueRanking: "逾期应收 Top 10",
        outstandingRanking: "未收金额 Top 10",
      },
      statuses: {
        sold: "已售",
        leased: "长租中",
        dailyOccupied: "日租中",
        reserved: "已预订",
        cleaningPending: "待保洁",
        maintenance: "维修/锁定",
        available: "空闲",
      },
      finance: {
        income: "本月收入",
        expense: "本月支出",
        net: "本月净额",
        dailyRental: "日租收入",
        leaseRent: "长租收入",
        sale: "出售收入",
        depositLiability: "押金/负债流入",
      },
      cockpit: {
        receivableThisMonth: "本月应收",
        paidThisMonth: "本月实收",
        outstandingThisMonth: "本月未收",
        overdueThisMonth: "本月逾期",
        incomeThisMonth: "本月收入",
        expenseThisMonth: "本月支出",
        netThisMonth: "本月净额",
        collectionRate: "收款率",
        unassigned: "未归属",
        dailyRental: "日租",
        leaseRental: "长租",
        sale: "出售",
        other: "其他",
        building: "楼栋",
        totalUnits: "房源数",
        receivable: "应收",
        paid: "已收",
        outstanding: "未收",
        overdue: "逾期",
        income: "收入",
        expense: "支出",
        net: "净额",
        overdueDays: "逾期天数",
        noOverdue: "暂无逾期应收",
        noOutstanding: "暂无未收款项",
      },
      risks: {
        cleaningPending: "待保洁房间",
        maintenanceLocked: "维修/锁定房间",
        leaseExpiring: "30天内到期长租",
        saleInstallments: "未完成出售分期",
        none: "暂无风险项",
        rooms: "间",
        contracts: "份合同",
      },
    }
  },
  fr: {
    meta: {
      title: "SACIS 3.0 | Gestion immobiliere Kejian",
      description: "Systeme pilote pour l'immeuble 11"
    },
    shell: {
      brand: "Kejian Immobilier",
      currentBuilding: "Immeuble actuel",
      language: "Français",
      otherLanguage: "中文",
      roles: {
        admin: "Administrateur",
        boss: "Proprietaire",
        finance: "Comptable",
        front_desk: "Reception"
      },
      notifications: {
        title: "Centre de notifications",
        empty: "Aucune notification",
        markRead: "Marquer lu",
        markAllRead: "Tout marquer lu",
        unread: "Non lu",
        leaseExpiry: "Expiration de bail",
        rentOverdue: "Loyer en retard",
        saleInstallment: "Echeance de vente",
        dailyCheckout: "Depart journalier"
      },
      nav: {
        dashboard: "Tableau de bord",
        units: "Lots 11#",
        dailyRentals: "Location jour",
        dailyOccupancy: "Occupation jour",
        leases: "Location longue",
        sales: "Vente",
        customers: "Clients",
        finance: "Finance",
        reports: "Rapports",
        settings: "Parametres",
        management: "Direction",
        documents: "Documents",
        todos: "Taches"
      }
    },
    statuses: {
      available: "Disponible",
      reserved: "Reserve",
      daily_occupied: "Occupe jour",
      cleaning_pending: "Menage requis",
      leased: "Loue long terme",
      sold: "Vendu",
      maintenance: "Maintenance",
      locked: "Bloque"
    },
    dashboard: {
      title: "Tableau de bord de l'immeuble 11",
      description: "La premiere phase active seulement l'immeuble 11, tout en gardant une structure extensible pour plusieurs immeubles.",
      metrics: {
        mainUnits: ["Appartements", "72 lots", "1-12F, 101-106 par etage"],
        dailyUnits: ["Location jour", "21 chambres", "Prix standard 40 000 XOF/nuit"],
        businessTypes: ["Activites", "3 types", "Jour, longue duree, vente"],
        futureBuildings: ["Extension", "5 immeubles", "3#/4#/5#/6#/7# a importer"]
      },
      modules: [
        ["Lots de l'immeuble 11", "Appartements, parkings, activites et statuts", "72 lots + parking", "/units"],
        ["Location journaliere", "21 chambres, reservation, arrivee, depart, menage", "40 000 XOF/nuit", "/daily-rentals"],
        ["Location longue duree", "Contrats, loyers dus, cautions, sortie", "Prix par typologie", "/leases"],
        ["Vente", "Contrats de vente, paiements, transfert", "Lots + parkings", "/sales"]
      ]
    },
    units: {
      title: "Lots de l'immeuble 11",
      description: "Les lots sont concus pour plusieurs immeubles. La phase pilote filtre building_code = SASCI11.",
      headers: ["Lot", "Etage", "Type", "Statut", "Activites", "Prix jour"],
      empty: "Aucun lot. Veuillez d'abord importer l'immeuble et les lots.",
      filters: {
        all: "Tous",
        floor: "Etage",
        status: "Statut",
        kind: "Type",
        business: "Activite"
      },
      kinds: {
        apartment: "Appartement",
        parking: "Parking",
        storefront: "Local commercial",
        office: "Bureau"
      },
      businessTypes: {
        daily_rental: "Jour",
        long_lease: "Long terme",
        sale: "Vente"
      },
      furnishing: {
        none: "Non meuble",
        basic: "Meuble simple",
        full: "Tout meuble"
      },
      actions: {
        import: "Importer",
        export: "Exporter Excel",
        changeStatus: "Modifier statut",
        viewDetail: "Details"
      },
      detail: {
        title: "Detail du lot",
        code: "Code",
        building: "Immeuble",
        floor: "Etage",
        kind: "Type",
        status: "Statut",
        area: "Surface",
        areaUnit: "m²",
        layout: "Typologie",
        furnishing: "Ameublement",
        dailyPrice: "Prix journalier",
        dailyPriceUnit: "XOF/nuit",
        supportedBusiness: "Activites autorisees",
        notes: "Remarques",
        noNotes: "Aucune remarque",
        photos: "Photos du lot",
        noPhotos: "Aucune photo",
        statusHistory: "Historique des statuts",
        noStatusHistory: "Aucun historique",
        notSet: "Non defini"
      },
      statusConfirm: "Confirmer le changement de statut en"
    },
    dailyRentals: {
      title: "Location journaliere",
      description: "Seulement 21 chambres fixes de l'immeuble 11. Les conflits avec les baux longs doivent etre bloques.",
      metrics: [
        ["Chambres", "21", "Liste marquee en base"],
        ["Prix par defaut", "40 000 XOF", "Ajustable dans la commande"],
        ["Paiement", "Avance", "Pas de paiement apres depart"]
      ],
      steps: [
        ["Reservation", "Creer une demande et valider manuellement"],
        ["Arrivee", "Enregistrer le client et l'avance"],
        ["Depart", "Calculer le montant et creer l'ecriture"],
        ["Menage", "Creer une tache apres depart"]
      ],
      bookingStatus: {
        pending_review: "A valider",
        confirmed: "Confirme",
        checked_in: "Arrive",
        checked_out: "Parti",
        cancelled: "Annule"
      },
      calendar: {
        today: "Aujourd'hui",
        prevMonth: "Mois prec.",
        nextMonth: "Mois suiv.",
        room: "Chambre",
        noRooms: "Aucune chambre journaliere",
        legendAvailable: "Disponible",
        legendBooked: "Reserve",
        legendMaintenance: "Maintenance",
        legendReserved: "Reservation",
        nightlyPrice: "/nuit"
      },
      booking: {
        title: "Reservation jour",
        newBooking: "Nouvelle reservation",
        editBooking: "Modifier",
        checkIn: "Arrivee",
        checkOut: "Depart rapide",
        extendStay: "Prolonger",
        confirmBooking: "Confirmer",
        cancelBooking: "Annuler",
        customer: "Choisir un client",
        checkInDate: "Date d'arrivee",
        checkOutDate: "Date de depart",
        nights: "nuits",
        nightlyPrice: "Prix par nuit",
        totalAmount: "Montant total",
        prepaidAmount: "Avance percue",
        remainingAmount: "Solde restant",
        paymentRecord: "Paiements",
        recordPayment: "Enregistrer paiement",
        receiptNo: "Numero de recu",
        otaSource: "Source OTA",
        notes: "Remarques",
        noCustomer: "Veuillez choisir un client",
        noBookings: "Aucune reservation sur la periode",
        confirmCheckIn: "Confirmer l'arrivee",
        confirmCheckOut: "Confirmer le depart",
        calculatedTotal: "Montant total calcule",
        prepaidWarning: "Une avance est exigee, pas de paiement apres depart",
        customerName: "Nom du client"
      },
      checkoutModeLabel: "Mode d'entree",
      fixedCheckout: "Depart fixe",
      openCheckout: "Sejour ouvert",
      actualCheckOutDate: "Date de depart reelle",
      supplementaryPayment: "Paiement supplementaire",
      discount: "Remise manuelle",
      discountAmount: "Montant remise",
      discountReason: "Motif remise",
      applyDiscount: "Appliquer remise",
      billing: {
        grossAmount: "Brut",
        discount: "Remise",
        finalAmount: "Net a payer",
        paid: "Paye",
        outstanding: "Solde du"
      },
      monthlyDiscountHint: "{nights} nuits passees. Remise long sejour possible. Brut {gross}, saisir remise manuelle.",
      openEndedBadge: "Ouvert",
      fixedBadge: "Depart fixe",
      conflicts: {
        longLeaseConflict: "Ce logement a un bail longue duree actif, reservation impossible",
        doubleBooked: "Ce logement est deja reserve aux dates choisies",
        unitMaintenance: "Ce logement est en maintenance",
        unitLocked: "Ce logement est bloque"
      },
      cleaning: {
        title: "Tache de menage",
        pending: "En attente",
        completed: "Termine",
        markComplete: "Marquer termine",
        autoCreated: "Cree automatiquement apres depart"
      },
      ota: {
        title: "Synchro OTA",
        placeholder: "Interface de synchro OTA reservee — a implementer"
      }
    },
    dailyOccupancy: {
      title: "Occupation journaliere",
      description: "Vue a partager chaque jour avec l'equipe : chambres occupees, client, arrivee, depart prevu, sejours ouverts et solde a payer.",
      shareTitle: "Message du jour pour le groupe",
      copy: "Copier le message",
      headers: ["Chambre", "Client", "Arrivee", "Depart/echeance", "Jours", "Facturation", "Paye", "Du", "Solde", "Remarques"],
      billingModes: {
        fixed_checkout: "Depart fixe",
        open_ended: "Sejour ouvert",
        monthly_discount: "Remise mensuelle"
      },
      openEnded: {
        label: "Date de depart inconnue",
        description: "La facturation commence a l'arrivee, puis le client regle le solde plus tard."
      },
      discountRule: {
        title: "Regle de remise mensuelle",
        example: "Exemple : 30 nuits x 4 000 = 120 000 XOF, remise manuelle possible a 110 000 XOF.",
        note: "La remise est confirmee manuellement par l'administrateur et journalisee."
      },
      empty: "Aucune chambre journaliere occupee.",
      summary: {
        occupied: "Chambres occupees",
        openEnded: "Departs inconnus",
        dueSoon: "Echeances proches",
        outstanding: "Solde a payer"
      }
    },
    leases: {
      title: "Location longue duree",
      description: "Numero de contrat manuel, loyers dus crees manuellement, un seul contrat actif par lot.",
      metrics: [["Tarification", "Par typologie", "Ajustable par contrat"], ["Cycle", "Mois/trimestre/semestre/an", "Paiement anticipe"], ["Sortie", "Automatique", "Loyer, eau/electricite, caution"]],
      empty: "Aucun contrat de location. Creez le premier contrat.",
      contractStatus: {
        draft: "Brouillon",
        active: "Actif",
        terminated: "Resilie",
        expired: "Expire"
      },
      paymentCycle: {
        monthly: "Mensuel",
        quarterly: "Trimestriel",
        semiannual: "Semestriel",
        annual: "Annuel"
      },
      form: {
        newContract: "Nouveau contrat",
        editContract: "Modifier contrat",
        contractNo: "N° contrat",
        unit: "Logement",
        customer: "Client",
        startDate: "Date debut",
        expectedEndDate: "Fin prevue",
        actualEndDate: "Fin reelle",
        paymentCycle: "Cycle de paiement",
        paymentDay: "Jour de paie",
        monthlyRent: "Loyer mensuel",
        deposit: "Caution",
        depositReceived: "Caution recue",
        rentFreeDays: "Jours de grace",
        signerName: "Signataire",
        attachment: "Piece jointe",
        notes: "Remarques",
        noUnit: "Choisir un logement",
        noCustomer: "Choisir un client",
        unitOccupied: "Ce logement a deja un contrat de location actif",
        contractNoRequired: "Le numero de contrat est obligatoire",
        statusLabel: "Statut",
        depositPaid: "✓Recu",
        depositUnpaid: "Non recu",
        activateContract: "Activer le contrat",
      },
      payment: {
        title: "Encaissement loyer",
        record: "Enregistrer paiement",
        amount: "Montant",
        paymentDate: "Date de paiement",
        receiptNo: "N° recu",
        coveringMonths: "Mois couverts",
        advancePayment: "Paiement anticipe",
        fullPaymentRequired: "Le loyer doit etre paye en totalite",
        totalPaid: "Total encaisse",
        expectedRent: "Loyer attendu",
        remaining: "Solde restant"
      },
      settlement: {
        title: "Sortie et cloture",
        moveOut: "Sortie et calcul",
        unpaidRent: "Loyer impaye",
        utilityCleared: "Eau/electricite soldees",
        depositDeduction: "Retenue caution (degats)",
        depositRefund: "Remboursement caution",
        totalRefund: "Montant a rembourser",
        totalDue: "Montant du",
        generateSettlement: "Generer le decompte de sortie",
        settlementNote: "Le logement redevient disponible apres cloture"
      },
      reminder: {
        title: "Rappel",
        dueSoon: "Echeance proche",
        overdue: "En retard",
        daysLeft: "Jours restants",
        sendReminder: "Envoyer rappel"
      },
      receivable: {
        title: "Echeancier des loyers",
        generate: "Generer echeances",
        generated: "{count} echeances generees",
        none: "Aucune echeance. Veuillez generer les echeances.",
        dueDate: "Echeance",
        amount: "Montant du",
        paid: "Paye",
        outstanding: "Impaye",
        status: "Statut",
        overdueDays: "Jours retard",
        collect: "Encaisser",
        fullPaymentNote: "Le loyer doit etre paye en totalite",
      },
      risk: {
        outstandingTotal: "Total impaye",
        overdueTotal: "Total retard",
        depositStatus: "Statut caution",
        expiringSoon: "Expiration proche",
        noRisk: "Aucun risque",
      },
    },
    sales: {
      title: "Vente",
      description: "Vente des lots et parkings avec paiement comptant, echeancier fixe ou flexible.",
      metrics: [["Perimetre", "Lots/parkings", "Immeuble 11 et parkings G/0"], ["Paiement", "3 modes", "Comptant, fixe, flexible"], ["Contrat", "Restaurable", "Retour disponible si rupture"]],
      empty: "Aucun contrat de vente. Creez le premier contrat.",
      contractStatus: {
        draft: "Brouillon",
        active: "Actif",
        terminated: "Resilie",
        expired: "Expire"
      },
      paymentPlan: {
        lump_sum: "Paiement comptant",
        fixed_installment: "Echeancier fixe",
        flexible_installment: "Echeancier libre"
      },
      transferStatus: {
        not_started: "Non commence",
        in_progress: "En cours",
        completed: "Termine"
      },
      form: {
        newContract: "Nouveau contrat de vente",
        editContract: "Modifier contrat",
        contractNo: "N° contrat",
        unit: "Lot/parking",
        customer: "Acheteur",
        signedDate: "Date signature",
        totalAmount: "Prix total",
        paymentPlan: "Mode de paiement",
        numInstallments: "Nombre d'echeances",
        transferDate: "Date transfert",
        transferStatus: "Statut transfert",
        titleCertificateNo: "N° titre foncier",
        agencyCompany: "Agence",
        agentName: "Agent",
        agencyCommission: "Commission agence",
        agencyCommissionPaid: "Commission payee",
        attachment: "Piece jointe",
        notes: "Remarques",
        noUnit: "Choisir un lot disponible",
        noCustomer: "Choisir un client",
        contractNoRequired: "Le numero de contrat est obligatoire",
        statusLabel: "Statut",
        addSchedule: "Ajouter",
        updateTransfer: "MAJ transfert",
      },
      installment: {
        title: "Echeancier de paiement",
        installmentNo: "Echeance",
        dueDate: "Date limite",
        amount: "Montant",
        status: "Statut",
        paid: "Paye",
        pending: "En attente",
        overdue: "En retard",
        addInstallment: "Ajouter echeance",
        earlyRepayment: "Remboursement anticipe",
        progress: "Progression"
      },
      payment: {
        title: "Encaissements",
        record: "Enregistrer paiement",
        amount: "Montant",
        paymentDate: "Date",
        receiptNo: "N° recu",
        selectInstallment: "Choisir l'echeance",
        totalPaid: "Total encaisse",
        remaining: "Solde restant"
      },
      terminate: {
        title: "Resiliation",
        confirm: "Confirmer resiliation",
        description: "Le lot redevient disponible. Les paiements restent enregistres.",
        reason: "Motif"
      },
      overview: {
        title: "Apercu des encaissements",
        totalPrice: "Prix total",
        paidAmount: "Montant encaisse",
        unpaidAmount: "Montant impaye",
        overdueAmount: "Montant en retard",
        collectionRate: "Taux d'encaissement",
      },
      paymentValidation: {
        amountExceeds: "Le montant ne peut pas depasser le du",
        alreadyPaid: "Cette echeance est deja payee",
        positiveRequired: "Le montant doit etre positif",
      },
    },
    customers: {
      title: "Dossiers clients",
      description: "Centre client commun aux locations et ventes. Nom obligatoire, documents chiffres, liste noire globale.",
      placeholder: "A implementer : liste, detail, fusion, liste noire, export/suppression.",
      empty: "Aucun client. Veuillez ajouter un premier client.",
      searchPlaceholder: "Rechercher par nom...",
      fields: {
        name: "Nom",
        gender: "Genre",
        documentType: "Type de piece",
        documentNumber: "Numero de piece",
        phone: "Telephone",
        notes: "Remarques"
      },
      gender: {
        male: "Homme",
        female: "Femme",
        other: "Autre"
      },
      documentTypes: {
        id_card: "Carte d'identite",
        passport: "Passeport",
        drivers_license: "Permis de conduire"
      },
      blacklist: {
        title: "Liste noire",
        reason: "Motif",
        operator: "Operateur",
        date: "Date",
        permanent: "Permanent",
        temporary: "Temporaire",
        add: "Ajouter a la liste noire",
        remove: "Retirer de la liste noire",
        warnTitle: "Ce client est sur la liste noire",
        warnMessage: "Les clients sur liste noire ne peuvent pas faire l'objet de nouvelles transactions.",
        reasonRequired: "Le motif est obligatoire"
      },
      actions: {
        add: "Nouveau client",
        edit: "Modifier",
        save: "Enregistrer",
        cancel: "Annuler",
        merge: "Fusionner",
        mergePlaceholder: "Fusion de clients — a implementer"
      },
      validation: {
        nameRequired: "Le nom du client est obligatoire",
        nameMinLength: "Le nom doit comporter au moins 2 caracteres"
      }
    },
    finance: {
      title: "Flux financiers",
      description: "Journal unique pour revenus journaliers, loyers, cautions, ventes et autres flux. Rapports en XOF.",
      metrics: [["Devises", "XOF/CNY", "Taux saisi manuellement"], ["Recu", "Champ requis", "Correspond au recu papier"], ["Comptabilite", "API reservee", "Export Excel/CSV d'abord"]],
      empty: "Aucune ecriture comptable.",
      directions: {
        income: "Revenu",
        expense: "Depense",
        liability_in: "Caution recue",
        liability_out: "Caution rendue"
      },
      categories: {
        daily_rental: "Revenu journalier",
        lease_rent: "Loyer longue duree",
        lease_deposit: "Caution location",
        sale: "Vente",
        other_income: "Autre revenu",
        maintenance: "Maintenance",
        cleaning_wages: "Salaire menage",
        garbage: "Ordures",
        utilities: "Eau/electricite",
        property_management: "Gestion immobiliere",
        tax: "Impot",
        agency_commission: "Commission agence",
        other_expense: "Autre depense"
      },
      filters: {
        all: "Tous",
        dateRange: "Periode",
        direction: "Type",
        category: "Categorie",
        building: "Immeuble",
        unit: "Lot"
      },
      entry: {
        title: "Nouvelle ecriture",
        date: "Date",
        direction: "Type",
        category: "Categorie",
        amount: "Montant",
        currency: "Devise",
        exchangeRate: "Taux (XOF=1)",
        amountXof: "Equivalent XOF",
        description: "Description",
        receiptNo: "N° recu",
        building: "Immeuble",
        unit: "Lot",
        save: "Enregistrer"
      },
      summary: {
        totalIncome: "Total revenus",
        totalExpense: "Total depenses",
        netBalance: "Solde net",
        period: "Periode"
      },
      export: {
        csv: "Exporter CSV",
        excel: "Exporter Excel",
        apiPlaceholder: "API comptable reservee — a implementer"
      }
    },
    reports: {
      title: "Rapports",
      description: "Les rapports filtrent l'immeuble 11 par defaut et gardent building_id pour comparer plusieurs immeubles.",
      items: ["Synthese mensuelle", "Profit immeuble 11", "Taux d'occupation jour", "Vacance longue duree", "Encaissement ventes", "Tresorerie"],
      placeholder: "A connecter a Supabase, graphiques et exports.",
      dateRange: "Periode",
      unit: "10k XOF",
      empty: "Aucune donnee sur la periode",
      emailSchedule: "Envoi programme — a implementer",
      monthlySummary: {
        title: "Synthese mensuelle",
        period: "Mois",
        income: "Revenus",
        expense: "Depenses",
        net: "Net"
      },
      occupancy: {
        title: "Taux d'occupation journalier",
        room: "Chambre",
        nightsBooked: "Nuits reservees",
        nightsAvailable: "Nuits disponibles",
        rate: "Taux",
        totalDays: "Jours totaux"
      },
      vacancy: {
        title: "Taux de vacance longue duree",
        totalUnits: "Lots louables",
        leasedUnits: "Lots loues",
        vacantUnits: "Lots vacants",
        rate: "Taux"
      },
      saleProgress: {
        title: "Encaissement ventes",
        contract: "Contrat",
        totalAmount: "Prix total",
        paidAmount: "Encaissements",
        progress: "Proportion",
        remaining: "Solde restant"
      }
    },
    settings: {
      title: "Parametres systeme",
      description: "Gestion des immeubles, prix, penalites, societe, modeles, roles et integrations.",
      placeholder: "A implementer : immeubles, roles, textes bilingues, mode sombre, sauvegarde, SMS/WhatsApp/API.",
      buildings: {
        title: "Gestion des immeubles",
        add: "Ajouter immeuble",
        code: "Code",
        displayName: "Nom",
        floors: "Etages",
        elevators: "Ascenseurs",
        active: "Actif",
        paused: "Suspendu",
        actions: "Actions",
        confirmAdd: "Confirmer ajout",
        noBuildings: "Aucun immeuble",
        codeRequired: "Le code est obligatoire",
        codeFormat: "Format: SASCI3 ~ SASCI11"
      },
      pricing: {
        title: "Configuration des prix",
        dailyDefault: "Prix journalier par defaut",
        dailyDefaultDesc: "Prix par nuit pour les 21 chambres journalieres",
        lateRate: "Taux de penalite",
        lateRateDesc: "Par 10 000 par jour, calcule automatiquement",
        save: "Enregistrer"
      },
      company: {
        title: "Information societe",
        name: "Nom de la societe",
        address: "Adresse",
        phone: "Telephone",
        logo: "Logo",
        save: "Enregistrer",
        desc: "Utilise pour les modeles d'impression et en-tetes"
      },
      language: {
        title: "Langue",
        zh: "中文（简体）",
        fr: "Français",
        current: "Langue actuelle"
      },
      darkMode: {
        title: "Mode sombre",
        toggle: "Basculer mode sombre",
        placeholder: "Mode sombre — a implementer"
      },
      print: {
        leaseContract: "Contrat de location",
        leaseSettlement: "Decompte de sortie",
        dailyReceipt: "Recu journalier",
        cleaningTask: "Fiche de menage",
        overdueNotice: "Avis de retard",
        print: "Imprimer",
        companyName: "Kejian Immobilier",
        contractNo: "N° contrat",
        date: "Date",
        total: "Total",
        signature: "Signature"
      }
    },
    mobile: {
      today: "Aujourd'hui",
      occupied: "Occupé",
      checkingOut: "Départ",
      cleaning: "Ménage",
      needTopUp: "À régler",
      reminders: "Rappels",
      allClear: "Rien à signaler",
      desktopOnly: "Veuillez utiliser la version bureau",
      desktopOnlyHint: "Mobile: consultation et actions simples",
      workbench: "Accueil",
      daily: "Jour",
      units: "Lots",
      profile: "Moi",
      tabs: {
        occupied: "Occupé",
        checkingOut: "Départ",
        cleaning: "Ménage",
        all: "Tous",
      },
      stats: {
        occupied: "Occupé",
        checkingOut: "Départ",
        cleaning: "Ménage",
        available: "Disponible",
      },
      roomCard: {
        checkOut: "Départ",
        pay: "Paiement",
        cleaningDone: "Ménage fait",
        more: "Plus",
        nights: "nuits",
        copyPhone: "Copier tél",
      },
      drawer: {
        title: "Détails chambre",
        guest: "Client",
        checkIn: "Arrivée",
        checkOut: "Départ",
        openEnded: "Ouvert",
        nights: "Nuitées",
        paid: "Payé",
        total: "Total",
        outstanding: "Dû",
        notes: "Notes",
        noNotes: "Aucune note",
      },
      actions: {
        checkOut: "Départ",
        checkOutConfirm: "Confirmer le départ ?",
        checkOutDesc: "La chambre passera en statut ménage après le départ",
        recordPayment: "Enregistrer paiement",
        recordPaymentTitle: "Montant du paiement",
        recordPaymentPlaceholder: "Saisir le montant",
        completeCleaning: "Ménage terminé",
        maintenance: "En maintenance",
        maintenanceConfirm: "Mettre en maintenance ?",
        maintenanceDesc: "La chambre ne sera pas disponible à la location",
        lock: "Verrouiller",
        lockConfirm: "Confirmer le verrouillage ?",
        lockDesc: "La chambre verrouillée ne peut pas être louée",
        markAvailable: "Rendre disponible",
        markAvailableConfirm: "Confirmer la remise à disposition ?",
        markAvailableDesc: "La chambre sera à nouveau disponible",
        success: "Opération réussie",
        failed: "Échec de l'opération",
        cancel: "Annuler",
        confirm: "Confirmer",
        extendStay: "Prolonger séjour",
        extendStayDesc: "Modifier la date de départ",
        modifyDates: "Modifier dates",
        save: "Enregistrer",
        amountRequired: "Veuillez saisir un montant valide",
      },
      empty: {
        noOccupied: "Aucune chambre occupée",
        noCheckouts: "Aucun départ aujourd'hui",
        noCleaning: "Aucun ménage en attente",
        noRooms: "Aucune chambre disponible",
        noAvailable: "Aucune chambre disponible",
        noReserved: "Aucune chambre reservee",
      },
    },
    receivables: {
      title: "Comptes clients",
      description: "Suivi unifie des creances : location jour, longue, vente. Suivi des encaissements et retards.",
      tabs: {
        ledger: "Flux",
        receivables: "Creances",
      },
      filters: {
        all: "Tout",
        status: "Statut",
        sourceType: "Source",
        dateRange: "Periode",
        building: "Immeuble",
      },
      statuses: {
        pending: "A recevoir",
        partial: "Partiel",
        paid: "Paye",
        overdue: "En retard",
        cancelled: "Annule",
      },
      sourceTypes: {
        daily_booking: "Jour",
        lease_contract: "LT",
        sale_contract: "Vente",
        manual: "Manuel",
      },
      categories: {
        daily_rental: "Location jour",
        lease_rent: "Loyer LT",
        lease_deposit: "Depot LT",
        sale_installment: "Echeance vente",
        sale_lump_sum: "Vente comptant",
        other: "Autre",
      },
      columns: {
        dueDate: "Echeance",
        building: "Immeuble",
        unit: "Chambre",
        customer: "Client",
        sourceType: "Source",
        category: "Categorie",
        title: "Libelle",
        amount: "Montant du",
        paid: "Paye",
        outstanding: "Du",
        status: "Statut",
        overdueDays: "Jours retard",
      },
      summary: {
        totalReceivable: "Total du",
        totalPaid: "Total paye",
        totalOutstanding: "Total du",
        totalOverdue: "Total retard",
        collectionRate: "Taux encaissement",
      },
      export: {
        csv: "Exporter CSV",
      },
      empty: "Aucune creance.",
    },
    management: {
      title: "Tableau de direction",
      description: "Vue direction : etat des lots par immeuble, resume financier et alertes. Donnees issues des tables metier existantes.",
      allBuildings: "Tous les immeubles",
      sections: {
        buildingStatus: "Etat des lots",
        financeOverview: "Resume financier du mois",
        riskAlerts: "Alertes",
        roomMatrix: "Matrice des lots",
        receivableOverview: "Apercu des creances",
        receivableByBusiness: "Par type d'activite",
        receivableByBuilding: "Par immeuble",
        overdueRanking: "Top 10 retards",
        outstandingRanking: "Top 10 impayes",
      },
      statuses: {
        sold: "Vendu",
        leased: "Loue LT",
        dailyOccupied: "Occupe jour",
        reserved: "Reserve",
        cleaningPending: "Menage",
        maintenance: "Maintenance",
        available: "Disponible",
      },
      finance: {
        income: "Revenus du mois",
        expense: "Depenses du mois",
        net: "Net du mois",
        dailyRental: "Location jour",
        leaseRent: "Location longue",
        sale: "Vente",
        depositLiability: "Depot / Passif",
      },
      cockpit: {
        receivableThisMonth: "Du du mois",
        paidThisMonth: "Encaisse du mois",
        outstandingThisMonth: "Impaye du mois",
        overdueThisMonth: "Retard du mois",
        incomeThisMonth: "Revenus du mois",
        expenseThisMonth: "Depenses du mois",
        netThisMonth: "Net du mois",
        collectionRate: "Taux d'encaissement",
        unassigned: "Non attribue",
        dailyRental: "Jour",
        leaseRental: "LT",
        sale: "Vente",
        other: "Autre",
        building: "Immeuble",
        totalUnits: "Lots",
        receivable: "Du",
        paid: "Encaisse",
        outstanding: "Impaye",
        overdue: "Retard",
        income: "Revenus",
        expense: "Depenses",
        net: "Net",
        overdueDays: "Jours retard",
        noOverdue: "Aucun retard",
        noOutstanding: "Aucun impaye",
      },
      risks: {
        cleaningPending: "Chambres a nettoyer",
        maintenanceLocked: "Chambres en maintenance",
        leaseExpiring: "Baux expirant sous 30 j",
        saleInstallments: "Echeances de vente impayees",
        none: "Aucune alerte",
        rooms: "chambres",
        contracts: "contrats",
      },
    }
  }
} as const;

export function routeFor(locale: Locale, href: string) {
  // Strip existing locale prefix first
  const path = href.startsWith("/fr/") ? href.slice(3) : href === "/fr" ? "/" : href;
  if (locale === "zh") return path;
  return path === "/" ? "/fr" : `/fr${path}`;
}
