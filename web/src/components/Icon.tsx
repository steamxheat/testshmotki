import {
  AlertTriangle, Bell, Check, ChevronDown, ChevronLeft, ChevronRight, Compass, Heart, House, Inbox,
  LockKeyhole, MapPin, MessageCircle, Package, Pencil, Phone, ReceiptText,
  Search, Send, Settings, Shield, Shirt, SlidersHorizontal, Star, UserRound, Paperclip,
  X, XCircle, Plus, LayoutDashboard, type LucideIcon,
  ShoppingBag,
} from 'lucide-react';

const icons = {
  alert: AlertTriangle,
  bell: Bell,
  check: Check,
  chevronDown: ChevronDown,
  chevronRight: ChevronRight,
  back: ChevronLeft,
  compass: Compass,
  heart: Heart,
  home: House,
  inbox: Inbox,
  lock: LockKeyhole,
  location: MapPin,
  chat: MessageCircle,
  package: Package,
  edit: Pencil,
  phone: Phone,
  orders: ReceiptText,
  cart: ShoppingBag,
  search: Search,
  send: Send,
  attach: Paperclip,
  settings: Settings,
  shield: Shield,
  catalog: Shirt,
  filters: SlidersHorizontal,
  star: Star,
  profile: UserRound,
  unavailable: XCircle,
  close: X,
  add: Plus,
  overview: LayoutDashboard,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof icons;

export function Icon({ name, size = 20, filled = false, className }: {
  name: IconName;
  size?: number;
  filled?: boolean;
  className?: string;
}) {
  const Component = icons[name];
  return <Component size={size} strokeWidth={1.8} fill={filled ? 'currentColor' : 'none'} className={className} aria-hidden="true" />;
}
