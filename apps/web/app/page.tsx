const roles = [
  {
    description: "浏览三家虚构门店，管理自己的预约、订单、权益和报修。",
    name: "顾客",
  },
  {
    description: "在所属门店处理到店、商品履约、报修、班次与交接。",
    name: "店员",
  },
  {
    description: "负责所属门店的经营配置、库存、员工排班与看板。",
    name: "店长",
  },
  {
    description: "维护连锁级资料，并列比较固定三家门店的经营情况。",
    name: "总部运营",
  },
] as const;

export default function PublicEntry() {
  return (
    <main>
      <section className="hero" aria-labelledby="product-title">
        <h1 id="product-title">竞枢 · Jingshu Arena</h1>
        <p className="summary">电竞场馆预约与运营协同演示</p>

        <ul className="boundaries" aria-label="演示边界">
          <li>全部内容均为演示数据</li>
          <li>无需注册</li>
          <li>模拟支付不会扣款</li>
          <li>不接入真实门店或设备</li>
        </ul>
      </section>

      <section className="roles" aria-labelledby="roles-title">
        <div className="section-heading">
          <h2 id="roles-title">从角色理解完整经营闭环</h2>
        </div>

        <div className="role-grid">
          {roles.map((role, index) => (
            <article className="role-card" key={role.name}>
              <span aria-hidden="true">0{index + 1}</span>
              <h3>{role.name}</h3>
              <p>{role.description}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
