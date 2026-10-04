# 商业财产保险理赔查勘与定损审核工作台

面向理赔员、专家与主管的商业财产险查勘工作台，覆盖损失科目、修复报价、残值、责任比例、准备金会签、争议项、附件版本和审计时间线。

## 技术栈

Angular + Angular Material + NgRx + Angular Router + HttpClient + RxJS + Angular CLI + TypeScript

## 本地运行

```bash
npm install
npm run start
```

访问 `http://localhost:62046`。

## 核心工作流

- 按案件和损失科目录入查勘事实、照片、报告与保单摘录。
- 调整修复报价时强制填写理由，并保留前后差异。
- 准备金按金额与风险阈值触发多级会签，可退回补件。
- 对比赔付方案、定位争议项、上传附件版本并导出完整审计记录。
