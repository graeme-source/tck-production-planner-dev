import { useListProductionPlans, useListStockEntries, useListDispatchOrders, useListSalesEntries } from "@workspace/api-client-react";
import { PageHeader } from "@/components/page-header";
import { format, isToday, isFuture } from "date-fns";
import { ArrowRight, AlertTriangle, ChefHat, Truck, TrendingUp, Package } from "lucide-react";
import { Link } from "wouter";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

export default function Dashboard() {
  const { data: plans } = useListProductionPlans();
  const { data: stock } = useListStockEntries();
  const { data: dispatches } = useListDispatchOrders();
  const { data: sales } = useListSalesEntries();

  const todayPlans = plans?.filter(p => isToday(new Date(p.planDate))) || [];
  const lowStock = stock?.filter(s => s.quantity < 10) || []; // Arbitrary threshold for demo
  const upcomingDispatches = dispatches?.filter(d => isFuture(new Date(d.dispatchDate)) && d.status === 'pending') || [];

  // Mock aggregate for chart
  const chartData = [
    { name: 'Mon', sales: 400 },
    { name: 'Tue', sales: 300 },
    { name: 'Wed', sales: 550 },
    { name: 'Thu', sales: 450 },
    { name: 'Fri', sales: 700 },
    { name: 'Sat', sales: 850 },
    { name: 'Sun', sales: 600 },
  ];

  return (
    <div className="space-y-6">
      <PageHeader 
        title="Kitchen Dashboard" 
        description={format(new Date(), "EEEE, MMMM do, yyyy")}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard 
          title="Today's Plans" 
          value={todayPlans.length.toString()} 
          icon={ChefHat} 
          color="text-primary" 
          bg="bg-primary/10" 
          href="/plans"
        />
        <StatCard 
          title="Low Stock Items" 
          value={lowStock.length.toString()} 
          icon={AlertTriangle} 
          color="text-accent" 
          bg="bg-accent/10" 
          href="/stock"
        />
        <StatCard 
          title="Pending Dispatches" 
          value={upcomingDispatches.length.toString()} 
          icon={Truck} 
          color="text-blue-500" 
          bg="bg-blue-500/10" 
          href="/dispatches"
        />
        <StatCard 
          title="Recent Sales" 
          value={sales?.length.toString() || "0"} 
          icon={TrendingUp} 
          color="text-emerald-500" 
          bg="bg-emerald-500/10" 
          href="/sales"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-8">
        <div className="lg:col-span-2 glass-panel p-6 rounded-2xl">
          <div className="flex items-center justify-between mb-6">
            <h3 className="font-display font-bold text-lg">Weekly Sales Overview</h3>
            <span className="text-xs text-muted-foreground bg-secondary px-2 py-1 rounded-md">Last 7 Days</span>
          </div>
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(value) => `$${value}`} />
                <Tooltip 
                  contentStyle={{ backgroundColor: 'hsl(var(--card))', borderRadius: '8px', border: '1px solid hsl(var(--border))', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                />
                <Line type="monotone" dataKey="sales" stroke="hsl(var(--primary))" strokeWidth={3} dot={{ fill: 'hsl(var(--primary))', strokeWidth: 2, r: 4 }} activeDot={{ r: 6 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="glass-panel rounded-2xl flex flex-col">
          <div className="p-6 border-b border-border">
            <h3 className="font-display font-bold text-lg">Today's Production</h3>
          </div>
          <div className="p-4 flex-1 overflow-y-auto space-y-3">
            {todayPlans.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground py-8">
                <Package className="w-12 h-12 mb-2 opacity-20" />
                <p>No plans for today.</p>
              </div>
            ) : (
              todayPlans.map(plan => (
                <div key={plan.id} className="p-4 rounded-xl bg-secondary/50 border border-border/50 hover-lift">
                  <div className="flex justify-between items-start mb-2">
                    <h4 className="font-semibold">{plan.name}</h4>
                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${plan.status === 'completed' ? 'bg-primary/20 text-primary' : 'bg-accent/20 text-accent'}`}>
                      {plan.status}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground line-clamp-1">{plan.notes || "No notes"}</p>
                </div>
              ))
            )}
          </div>
          <div className="p-4 border-t border-border">
            <Link href="/plans" className="text-sm font-medium text-primary flex items-center justify-center gap-1 hover:underline">
              View all plans <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ title, value, icon: Icon, color, bg, href }: any) {
  return (
    <Link href={href}>
      <div className="glass-panel p-6 rounded-2xl hover-lift cursor-pointer group">
        <div className="flex items-center gap-4">
          <div className={`p-4 rounded-2xl ${bg} ${color} transition-transform group-hover:scale-110`}>
            <Icon className="w-6 h-6" />
          </div>
          <div>
            <p className="text-sm font-medium text-muted-foreground mb-1">{title}</p>
            <h3 className="text-3xl font-display font-bold">{value}</h3>
          </div>
        </div>
      </div>
    </Link>
  );
}
