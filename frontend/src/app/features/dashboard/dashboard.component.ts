import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule],
  template: `<div class="page"><h1>Сьогодні</h1><p>— реалізація у Кроці 2.5 —</p></div>`,
})
export class DashboardComponent {}
