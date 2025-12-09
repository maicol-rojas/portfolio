import { Routes } from '@angular/router';
import { Home } from './features/home/pages/home/home';


export const routes: Routes = [

    {
        path: '',
        component: Home
    },
    {
        path: 'inicio',
        component: Home
    }

];
