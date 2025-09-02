import { Component } from '@angular/core';
import { NgForm } from '@angular/forms';
import { Router } from '@angular/router';
import { ClientService } from 'src/app/core/services/client.service';
import { ToastService } from 'src/app/core/services/toast.service';

@Component({
  selector: 'app-add-merchant',
  templateUrl: './add-merchant.component.html',
  styleUrls: ['./add-merchant.component.css']
})
export class AddMerchantComponent {
  currentDate = new Date().toLocaleDateString();
  currentTime = new Date().toLocaleTimeString();

  selectedArea: string = '';
  selectedSubArea: string = '';
  subAreaOptions: string[] = [];
  saving = false;

  areaToSubareas: { [key: string]: string[] } = {
    'Andheri (East)': ['Marol', 'Saki Naka', 'Chakala', 'JB Nagar'],
    'Andheri (West)': ['Lokhandwala', 'DN Nagar', 'Versova', 'Oshiwara'],
    'Airoli': ['Sector 3', 'Rabale MIDC', 'Mindspace'],
    'Bandra (East)': ['Kalanagar', 'BKC', 'Government Colony'],
    'Bandra (West)': ['Pali Hill', 'Bandra Reclamation', 'Mount Mary', 'Hill Road'],
    'Bhandup (East)': ['Bhandup Station', 'Hari Om Nagar', 'Nahur'],
    'Bhandup (West)': ['Dreams Mall', 'Tembhipada'],
    'Borivali (East)': ['Babhai Naka', 'Shimpoli', 'Carter Road No 2', 'Nancy Colony'],
    'Borivali (West)': ['IC Colony', 'Gorai', 'Shimpoli', 'MHB Colony'],
    'CBD Belapur': ['Sector 15', 'Sector 11', 'Belapur Village'],
    'Chembur': ['Diamond Garden', 'Shell Colony', 'RC Marg', 'Sindhi Society'],
    'Colaba': ['Colaba Market', 'Navy Nagar', 'Regal', 'Afghan Church'],
    'Dadar (East)': ['TT Circle', 'Bhavani Shankar Rd', 'Parel TT'],
    'Dadar (West)': ['Shivaji Park', 'Portuguese Church', 'Kabutar Khana'],
    'Dahisar (East)': ['Rawalpada', 'Ghartanpada', 'Ovaripada'],
    'Dahisar (West)': ['LT Road', 'Mandapeshwar', 'Ashok Van'],
    'Fort': ['Ballard Estate', 'CST', 'Horniman Circle', 'BSE Road'],
    'Ghatkopar (East)': ['Pant Nagar', 'Garodia Nagar', 'Tilak Nagar'],
    'Ghatkopar (West)': ['Vikrant Circle', 'Amrut Nagar', 'Sarvodaya Nagar'],
    'Goregaon (East)': ['Aarey Colony', 'Film City', 'Nagari Nivara', 'Dindoshi'],
    'Goregaon (West)': ['MG Road', 'Bangur Nagar', 'Motilal Nagar', 'Unnat Nagar'],
    'Jogeshwari (East)': ['Behrambaug', 'Meghwadi', 'Sarvoday Nagar'],
    'Jogeshwari (West)': ['SV Road Area', 'Majaswadi'],
    'Kalina': ['University Road', 'Military Camp', 'Air India Colony'],
    'Kanjurmarg (East)': ['Neptune Magnet Mall', 'Bhandup Pumping'],
    'Kanjurmarg (West)': ['LBS Road', 'Huma Mall Area'],
    'Kandivali (East)': ['Thakur Village', 'Lokhandwala Twp', 'Samata Nagar', 'Akurli Road'],
    'Kandivali (West)': ['Charkop', 'Mahavir Nagar', 'Shimpoli', 'Dahanukar Wadi'],
    'Kharghar': ['Sector 7', 'Sector 20', 'Golf Course Road'],
    'Kurla (East)': ['Kamani', 'Nehru Nagar', 'Netaji Nagar'],
    'Kurla (West)': ['Kalina Link Road', 'Pipe Road', 'Qureshi Nagar'],
    'Lower Parel': ['Phoenix Mills', 'Elphinstone Road', 'Worli Naka'],
    'Malad (East)': ['Kurar Village', 'Daftary Road', 'Pushpa Park', 'Pathanwadi'],
    'Malad (West)': ['Evershine Nagar', 'Liberty Garden', 'Orlem', 'Chincholi Bunder'],
    'Mazgaon': ['Dockyard Road', 'Mazgaon Garden', 'Joseph Baptista Garden'],
    'Mulund (East)': ['Hari Om Nagar', 'Navghar', 'Asha Nagar'],
    'Mulund (West)': ['Zaver Road', 'Veena Nagar', 'Gavani Pada', 'Johnson & Johnson'],
    'Nerul': ['Sector 21', 'LP Junction', 'Rock Garden'],
    'Panvel': ['Old Panvel', 'New Panvel', 'Kalamboli'],
    'Parel': ['Lalbaug', 'Fadnavis Chowk', 'Shivdi'],
    'Powai': ['Hiranandani Gardens', 'Chandivali', 'Nahar Amrit Shakti', 'Raheja Vihar', 'Lake Homes'],
    'Sanpada': ['Sector 4', 'Morarji Nagar'],
    'Santacruz (East)': ['Vakola', 'Prabhat Colony', 'Kalina'],
    'Santacruz (West)': ['Juhu', 'Hasmukh Nagar', 'Railway Colony'],
    'Seawoods': ['NRI Complex', 'Seawoods East'],
    'Sion': ['Everard Nagar', 'Guru Tegh Bahadur Nagar', 'Koliwada', 'Antop Hill'],
    'Thane (East)': ['Kopri', 'Hariniwas', 'Ram Maruti Road'],
    'Thane (West)': ['Ghodbunder Road', 'Vartak Nagar', 'Wagle Estate'],
    'Vashi': ['Sector 17', 'Palm Beach', 'Sector 9', 'APMC Market'],
    'Vikhroli (East)': ['Kannamwar Nagar', 'Tagore Nagar'],
    'Vikhroli (West)': ['Parksite', 'Station Road'],
    'Vile Parle (East)': ['Hanuman Road', 'Nehrunagar', 'Navpada'],
    'Vile Parle (West)': ['Irla', 'Juhu Lane', 'Bhavans College'],
    'Wadala': ['Bhakti Park', 'Dadar TT', 'Sewri', 'Wadala Depot'],
  };

  get areaKeys(): string[] {
    return Object.keys(this.areaToSubareas);
  }

  constructor(
    private clientService: ClientService,
    private router: Router,
    private toast: ToastService
  ) {}

  onAreaChange(): void {
    this.subAreaOptions = this.areaToSubareas[this.selectedArea] || [];
    this.selectedSubArea = '';
  }

  onSubmit(form: NgForm): void {
    if (!form.valid) {
      this.toast.warn('Please fill all required fields.');
      return;
    }
    if (!this.selectedArea) {
      this.toast.warn('Please select an Area.');
      return;
    }
    if (this.subAreaOptions.length && !this.selectedSubArea) {
      this.toast.warn('Please select a Sub Area.');
      return;
    }

    const now = new Date();
    const clientData = {
      ...form.value,
      area: this.selectedArea,
      subArea: this.selectedSubArea,
      dateOfEntry: now.toLocaleDateString(),
      entryTime: now.toLocaleTimeString()
    };

    this.saving = true;
    this.clientService.saveClient(clientData).subscribe({
      next: () => {
        this.toast.success('Merchant added successfully!');
        this.saving = false;
        this.router.navigate(['/dashboard']);
      },
      error: (err) => {
        console.error('Failed to save client:', err);
        this.toast.error(err.error?.message || 'Failed to save merchant. Please try again.');
        this.saving = false;
      }
    });
  }

  backToHome(): void {
    this.router.navigate(['/dashboard']);
  }
}