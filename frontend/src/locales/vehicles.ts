import type { LocaleBundle } from './index';

/** 车辆与 RUC 路税页（VehiclesPage）的文案 */
export const vehicles: LocaleBundle = {
  zh: {
    // 页头
    'vehicles.title': '车辆与 RUC 路税',
    'vehicles.refresh': '刷新',
    'vehicles.add': '登记车辆',

    // 提示消息
    'vehicles.loadFailed': '加载失败',
    'vehicles.actionFailed': '操作失败',
    'vehicles.added': '已登记',
    'vehicles.deleted': '已删除',
    'vehicles.licenceRecorded': '许可已登记',
    'vehicles.calibrated': '里程已校准',

    // RUC 状态
    'vehicles.levelUnknown': '未登记',
    'vehicles.levelOk': '正常',
    'vehicles.levelWarn': '需安排购买',
    'vehicles.levelCritical': '即将用完',
    'vehicles.levelExceeded': '已超出许可',

    // 表格列
    'vehicles.colPlate': '车牌',
    'vehicles.colRucStatus': 'RUC 状态',
    'vehicles.colRemaining': '剩余里程',
    'vehicles.noLicence': '未登记许可',
    'vehicles.kmOver': '已超出 {{km}} km',
    'vehicles.colProjected': '预计用完',
    'vehicles.notEnoughData': '用量不足，暂不预估',
    'vehicles.inDays': '约 {{n}} 天后',
    'vehicles.kmPerDay': '{{n}} km/天',
    'vehicles.colOdometer': '里程（估算）',
    'vehicles.odoTip': '系统按定位器里程估算，与车上 hubodometer 会有误差。定期用实际读数校准可以让提醒更准。',
    'vehicles.neverCalibrated': '从未校准',
    'vehicles.calibratedDaysAgo': '{{n}} 天前校准',
    'vehicles.colLicence': '许可',
    'vehicles.noLicenceNo': '无单号',
    'vehicles.colActions': '操作',

    // 行内操作
    'vehicles.btnRecordLicence': '登记许可',
    'vehicles.btnCalibrate': '校准里程',
    'vehicles.btnRecordLicenceShort': '许可',
    'vehicles.btnCalibrateShort': '校准',
    'vehicles.deleteConfirm': '确定删除这辆车？',
    'vehicles.delete': '删除',
    'vehicles.cancel': '取消',

    // 告警与说明
    'vehicles.attentionTitle': '{{n}} 辆车的 RUC 路税需要处理',
    'vehicles.kmLeft': '剩 {{km}} km',
    'vehicles.infoTitle': '里程为系统估算值，购买 RUC 时请以车上 hubodometer 的实际读数为准',
    'vehicles.infoDesc': '系统按车载定位器上报的里程累计，用于提前提醒；购买本身仍需在 NZTA 或代理处办理（自动购买需要 NZTA 认证的电子里程记录资质）。',
    'vehicles.emptyText': '还没有登记车辆。登记后即可跟踪 RUC 路税剩余里程。',

    // 登记车辆弹窗
    'vehicles.okAdd': '登记',
    'vehicles.fieldPlate': '车牌',
    'vehicles.plateRequired': '请输入车牌',
    'vehicles.plateExtra': '要与定位器登记、司机接单时填写的车牌一致',
    'vehicles.fieldLabel': '备注名称',
    'vehicles.labelPlaceholder': '例如：1 号车',

    // 登记 RUC 许可弹窗
    'vehicles.rucModalTitle': '登记 RUC 许可 · {{plate}}',
    'vehicles.rucModalHint': '按购买到的 RUC 许可上的里程范围填写。保存后提醒会重新开始计算。',
    'vehicles.save': '保存',
    'vehicles.fieldLicenceNo': '许可编号',
    'vehicles.optional': '选填',
    'vehicles.fieldStartKm': '起始里程 (km)',
    'vehicles.required': '请填写',
    'vehicles.fieldEndKm': '截止里程 (km)',
    'vehicles.endGreaterThanStart': '截止里程必须大于起始里程',
    'vehicles.endKmExtra': '跑到这个里程之前必须续买',
    'vehicles.fieldPurchasedAt': '购买日期',

    // 校准里程弹窗
    'vehicles.odoModalTitle': '校准里程 · {{plate}}',
    'vehicles.odoModalHint': '填写车上 hubodometer（里程计）的实际读数。这会成为新的基准，之后继续按定位器里程累加。',
    'vehicles.fieldCurrentKm': '当前实际里程 (km)',
  },
  en: {
    'vehicles.title': 'Vehicles & RUC',
    'vehicles.refresh': 'Refresh',
    'vehicles.add': 'Add vehicle',

    'vehicles.loadFailed': 'Failed to load',
    'vehicles.actionFailed': 'Action failed',
    'vehicles.added': 'Vehicle added',
    'vehicles.deleted': 'Deleted',
    'vehicles.licenceRecorded': 'Licence recorded',
    'vehicles.calibrated': 'Odometer calibrated',

    'vehicles.levelUnknown': 'No licence',
    'vehicles.levelOk': 'OK',
    'vehicles.levelWarn': 'Buy soon',
    'vehicles.levelCritical': 'Almost out',
    'vehicles.levelExceeded': 'Over licence',

    'vehicles.colPlate': 'Plate',
    'vehicles.colRucStatus': 'RUC status',
    'vehicles.colRemaining': 'Distance remaining',
    'vehicles.noLicence': 'No licence recorded',
    'vehicles.kmOver': '{{km}} km over licence',
    'vehicles.colProjected': 'Projected to run out',
    'vehicles.notEnoughData': 'Not enough usage data to project',
    'vehicles.inDays': 'in about {{n}} days',
    'vehicles.kmPerDay': '{{n}} km/day',
    'vehicles.colOdometer': 'Odometer (est.)',
    'vehicles.odoTip': 'Estimated from tracker distance, so it drifts from the hubodometer on the truck. Calibrate it with the real reading regularly to keep the warnings accurate.',
    'vehicles.neverCalibrated': 'never calibrated',
    'vehicles.calibratedDaysAgo': 'calibrated {{n}}d ago',
    'vehicles.colLicence': 'Licence',
    'vehicles.noLicenceNo': 'no number',
    'vehicles.colActions': 'Actions',

    'vehicles.btnRecordLicence': 'Record licence',
    'vehicles.btnCalibrate': 'Calibrate odometer',
    'vehicles.btnRecordLicenceShort': 'Licence',
    'vehicles.btnCalibrateShort': 'Calibrate',
    'vehicles.deleteConfirm': 'Delete this vehicle?',
    'vehicles.delete': 'Delete',
    'vehicles.cancel': 'Cancel',

    'vehicles.attentionTitle': '{{n}} vehicle(s) need RUC action',
    'vehicles.kmLeft': '{{km}} km left',
    'vehicles.infoTitle': 'The distance shown here is an estimate — always buy RUC against the actual hubodometer reading on the truck',
    'vehicles.infoDesc': 'Distance is accumulated from what the on-board tracker reports and is only meant to warn you early. The purchase itself must still be made through NZTA or an agent (automatic purchasing requires an NZTA-approved electronic distance recorder).',
    'vehicles.emptyText': 'No vehicles registered yet. Add one to start tracking its remaining RUC distance.',

    'vehicles.okAdd': 'Add',
    'vehicles.fieldPlate': 'Plate',
    'vehicles.plateRequired': 'Please enter the plate',
    'vehicles.plateExtra': 'Must match the plate registered on the tracker and the one drivers type when accepting a job',
    'vehicles.fieldLabel': 'Label',
    'vehicles.labelPlaceholder': 'e.g. Truck #1',

    'vehicles.rucModalTitle': 'Record RUC licence · {{plate}}',
    'vehicles.rucModalHint': 'Enter the distance range printed on the RUC licence you bought. Saving restarts the warnings from that range.',
    'vehicles.save': 'Save',
    'vehicles.fieldLicenceNo': 'Licence number',
    'vehicles.optional': 'Optional',
    'vehicles.fieldStartKm': 'Start reading (km)',
    'vehicles.required': 'Required',
    'vehicles.fieldEndKm': 'End reading (km)',
    'vehicles.endGreaterThanStart': 'The end reading must be greater than the start reading',
    'vehicles.endKmExtra': 'You must buy the next licence before the truck passes this reading',
    'vehicles.fieldPurchasedAt': 'Purchased on',

    'vehicles.odoModalTitle': 'Calibrate odometer · {{plate}}',
    'vehicles.odoModalHint': 'Enter the actual reading from the hubodometer on the truck. It becomes the new baseline, and tracker distance is added on top of it from then on.',
    'vehicles.fieldCurrentKm': 'Current hubodometer reading (km)',
  },
};
